/**
 * Internal Medusa Store scope preflight — NOT an HTTP route or purchase grant.
 * The sales-channel IDs must come from MedusaStoreRequest.publishable_key_context,
 * NEVER from the caller's query string or a self-declared request body.
 */
export type VariantVisibilityDecision = Readonly<{
  variantId: string
  visible: boolean
  /** Trusted variant metadata; missing/invalid policy must remain unknown. */
  minShelfLifeDays: number | null
}>

export interface MedusaVariantQuery {
  graph(input: {
    entity: "variant"
    fields: string[]
    filters: { id: string[] }
  }): Promise<{ data: unknown }>
}
const identifier = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 255 &&
  /^[A-Za-z0-9_-]+$/.test(value)

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null

const policy = (metadata: unknown): number | null => {
  const root = record(metadata)
  const packaging = record(root?.packaging)
  const raw = packaging?.min_shelf_life_days
  // Preserve the ledger-compatible canonical numeric-string policy, but keep
  // this display-only projection conservatively bounded at 365 days.
  const days = typeof raw === "number" ? raw :
    typeof raw === "string" && /^(0|[1-9]\\d*)$/.test(raw) ? Number(raw) : NaN
  return Number.isSafeInteger(days) && days >= 0 && days <= 365 ? days : null
}

/**
 * Restrict variants to products explicitly published in one of the sales
 * channels of the validated publishable-key context. Only batch-managed
 * variants with manage_inventory exactly false may return visible. A query failure, empty
 * scope, missing association, missing publication state or unexpected record
 * never authorizes a stock read. Product metadata is not browser supplied.
 *
 * This is only one half of public authorization: a separately verified
 * sales-channel -> actual custom inventory_location mapping is still needed.
 */
export async function resolveScopedVariantPolicies(
  query: MedusaVariantQuery,
  variantIds: readonly string[],
  trustedSalesChannelIds: readonly string[]
): Promise<VariantVisibilityDecision[]> {
  if (!Array.isArray(variantIds) || variantIds.length < 1 || variantIds.length > 100 ||
      variantIds.some((id) => !identifier(id)) ||
      new Set(variantIds).size !== variantIds.length) {
    throw new TypeError("Invalid requested variant IDs")
  }

  const unknown = (): VariantVisibilityDecision[] =>
    variantIds.map((variantId) => ({ variantId, visible: false, minShelfLifeDays: null }))

  if (!Array.isArray(trustedSalesChannelIds) ||
      trustedSalesChannelIds.length < 1 || trustedSalesChannelIds.length > 100 ||
      trustedSalesChannelIds.some((id) => !identifier(id)) ||
      new Set(trustedSalesChannelIds).size !== trustedSalesChannelIds.length) return unknown()

  const scoped = new Set(trustedSalesChannelIds)
  try {
    // Confirmed Medusa Query entity/relations: "variant", "product.sales_channels.id".
    const response = await query.graph({
      entity: "variant",
      fields: ["id", "metadata", "manage_inventory", "product.id", "product.status", "product.sales_channels.id"],
      filters: { id: [...variantIds] },
    })
    if (!response || !Array.isArray(response.data)) return unknown()
    const data = new Map<string, VariantVisibilityDecision>()
    for (const value of response.data) {
      const variant = record(value)
      if (!identifier(variant?.id) || data.has(variant.id) || !variantIds.includes(variant.id))
        return unknown()
      const product = record(variant.product)
      const channels = product?.sales_channels
      const published = product?.status === "published" && identifier(product?.id)
      const allowed = published && variant.manage_inventory === false && Array.isArray(channels) && channels.some((entry: unknown) => {
        const channel = record(entry)
        return identifier(channel?.id) && scoped.has(channel.id)
      })
      data.set(variant.id, {
        variantId: variant.id,
        visible: Boolean(allowed),
        minShelfLifeDays: allowed ? policy(variant.metadata) : null,
      })
    }
    return variantIds.map((variantId) => data.get(variantId) ??
      { variantId, visible: false, minShelfLifeDays: null })
  } catch {
    return unknown()
  }
}
