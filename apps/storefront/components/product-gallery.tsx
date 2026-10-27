"use client"

import { useState } from "react"
import Image from "next/image"
import { getDictionary, type Locale } from "../lib/i18n"

export function ProductGallery({
  images,
  title,
  locale = "ar",
}: {
  images: string[]
  title: string
  locale?: Locale
}) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const dict = getDictionary(locale)
  const activeImage = images[selectedIndex] || images[0]

  if (!images.length || !activeImage) {
    return (
      <div className="detail-gallery">
        <div className="detail-no-photo">{dict.product.noPhoto}</div>
      </div>
    )
  }

  return (
    <div className="detail-gallery">
      <div className="detail-main-wrapper">
        <Image
          src={activeImage}
          alt={dict.product.galleryAlt(title, selectedIndex)}
          width={800}
          height={800}
          priority
          unoptimized
          className="detail-main-photo"
        />
      </div>
      {images.length > 1 ? (
        <div className="detail-thumbs" role="tablist" aria-label={dict.product.galleryAlt(title, 0)}>
          {images.slice(0, 5).map((url, index) => {
            const isSelected = index === selectedIndex
            return (
              <button
                key={url}
                type="button"
                role="tab"
                aria-selected={isSelected}
                aria-label={dict.product.galleryAlt(title, index)}
                className={`detail-thumb-button ${isSelected ? "active" : ""}`}
                onClick={() => setSelectedIndex(index)}
              >
                <Image
                  src={url}
                  alt=""
                  width={180}
                  height={180}
                  unoptimized
                  className="detail-thumb-image"
                />
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
