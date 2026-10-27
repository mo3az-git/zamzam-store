"use client"

import { useState } from "react"
import Image from "next/image"

export function ProductGallery({
  images,
  title,
  galleryLabel,
  noImageText,
}: {
  images: string[]
  title: string
  galleryLabel: string
  noImageText: string
}) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const activeImage = images[selectedIndex] ?? images[0]

  if (!images.length || !activeImage) {
    return (
      <div className="detail-gallery" aria-label={galleryLabel}>
        <div className="detail-no-photo">{noImageText}</div>
      </div>
    )
  }

  return (
    <div className="detail-gallery" aria-label={galleryLabel}>
      <div className="detail-main-wrapper">
        <Image
          src={activeImage}
          alt={title}
          width={800}
          height={800}
          unoptimized
          className="detail-main-photo"
          priority={selectedIndex === 0}
        />
      </div>
      {images.length > 1 ? (
        <div className="detail-thumbs" role="tablist" aria-label={galleryLabel}>
          {images.slice(0, 5).map((url, index) => {
            const isSelected = index === selectedIndex
            return (
              <button
                key={url}
                type="button"
                role="tab"
                aria-selected={isSelected}
                aria-label={`${title} — ${index + 1}`}
                className={`detail-thumb-button ${isSelected ? "is-active" : ""}`}
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
