import test from "node:test"
import assert from "node:assert/strict"
import { EGYPTIAN_GOVERNORATES as frontend, resolveGovernorateProvince, mapGuestCheckoutToBackend, isValidGovernorate } from "../lib/checkout.ts"
import { getDictionary } from "../lib/i18n.ts"
import { EGYPTIAN_GOVERNORATES as backend, resolveEgyptianMedusaProvinceCode, resolveEgyptianGovernorateId, getGovernorateShippingBlockers } from "../../backend/src/modules/batch-inventory/egypt-shipping-configuration.ts"

test("Phase 4.8 integration: exact 27-governorate storefront/Medusa geography contract", () => {
  assert.equal(frontend.length, 27)
  assert.equal(backend.length, 27)
  assert.equal(new Set(frontend.map(g => g.code)).size, 27)
  assert.equal(new Set(backend.map(g => g.medusaProvinceCode)).size, 27)
  const backById = new Map(backend.map(g => [g.id, g]))
  for (const f of frontend) {
    const b = backById.get(f.code)
    assert.ok(b, "Backend is missing governorate: " + f.code)
    assert.equal(f.nameAr, b.nameAr)
    assert.equal(f.nameEn, b.nameEn)
    assert.equal(f.provinceCode, b.medusaProvinceCode)
    assert.equal(f.provinceCode, b.iso3166_2.toLowerCase())
    assert.equal(resolveGovernorateProvince(f.code), f.provinceCode)
    assert.equal(resolveEgyptianMedusaProvinceCode(f.provinceCode)?.id, f.code)
    assert.equal(resolveEgyptianGovernorateId(f.code)?.id, f.code)
    assert.deepEqual(getGovernorateShippingBlockers(f.code), [
      "SHIPPING_COVERAGE_UNCONFIGURED",
      "SHIPPING_RATE_UNCONFIGURED",
      "SHIPPING_PROVIDER_UNDECIDED",
    ])
  }
})

test("Phase 4.8 integration: unknown/ambiguous governorates fail closed; no shipping prices invented", () => {
  const dict = getDictionary("ar")
  const validGuest = {
    firstName: "QA", lastName: "Guest", email: "qa@example.invalid",
    phone: "01012345678", city: "القاهرة", address: "10 QA Test Street",
  }
  for (const invalid of ["Cairo", "CAIRO", "eg-c", "القاهرة", " cairo ", "unknown", ""]) {
    assert.equal(isValidGovernorate(invalid), false, invalid)
    assert.equal(resolveGovernorateProvince(invalid), null, invalid)
    assert.equal(mapGuestCheckoutToBackend({ ...validGuest, governorate: invalid }, dict).success, false, invalid)
  }
  for (const gov of frontend) {
    const result = mapGuestCheckoutToBackend({ ...validGuest, governorate: gov.code }, dict)
    assert.equal(result.success, true, gov.code)
    if(result.success) assert.equal(result.payload.province, gov.provinceCode, gov.code)
  }
  assert.equal(backend.every(g => !("amount" in g)), true)
})
