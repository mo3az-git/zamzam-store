/**
 * Abstract oasis illustration. Editorial artwork, not a product photograph.
 * Kept as lightweight vector shapes; no third-party image assets.
 */
export function OasisIllustration() {
  return (
    <svg className="oasis-svg" viewBox="0 0 620 680" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="oasisBackdrop" x1="80" y1="120" x2="540" y2="610" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2F7560" />
          <stop offset="0.48" stopColor="#16463B" />
          <stop offset="1" stopColor="#092D28" />
        </linearGradient>
        <linearGradient id="oasisSand" x1="100" y1="380" x2="515" y2="590" gradientUnits="userSpaceOnUse">
          <stop stopColor="#D6B67C" />
          <stop offset="1" stopColor="#F0DEB6" />
        </linearGradient>
        <linearGradient id="oasisWater" x1="120" y1="360" x2="535" y2="615" gradientUnits="userSpaceOnUse">
          <stop stopColor="#B4D3C7" />
          <stop offset="0.6" stopColor="#7CB9AC" />
          <stop offset="1" stopColor="#43877B" />
        </linearGradient>
        <clipPath id="oasisArch">
          <path d="M68 594V264C68 120 178 34 309 34S550 120 550 264V594Q550 620 524 620H94Q68 620 68 594Z" />
        </clipPath>
        <pattern id="oasisDots" width="22" height="22" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1.1" fill="#F5E6C4" opacity="0.38"/>
        </pattern>
      </defs>

      <path d="M68 594V264C68 120 178 34 309 34S550 120 550 264V594Q550 620 524 620H94Q68 620 68 594Z" fill="url(#oasisBackdrop)"/>
      <g clipPath="url(#oasisArch)">
        <path d="M68 40H550V620H68Z" fill="url(#oasisDots)" />
        <circle cx="357" cy="244" r="166" fill="#EBD8AA"/>
        <circle cx="357" cy="244" r="193" stroke="#ECDCB6" strokeOpacity=".34" strokeWidth="1.5"/>
        <circle cx="357" cy="244" r="216" stroke="#ECDCB6" strokeOpacity=".16" strokeWidth="1"/>
        <path d="M-34 426C82 381 132 391 211 426C295 465 351 457 432 409C488 374 559 361 660 392V665H-34V426Z" fill="#C4D9BA"/>
        <path d="M-35 462C81 411 146 433 223 482C309 538 387 460 458 441C524 422 578 445 660 475V665H-35V462Z" fill="url(#oasisWater)"/>
        <path d="M-32 520C66 464 146 479 234 525C322 572 413 521 503 493C581 469 627 500 667 516V678H-32V520Z" fill="#196758" opacity=".8"/>
        <path d="M-32 558C69 504 151 514 224 555C326 610 407 570 511 540C589 519 627 537 671 558V685H-32V558Z" fill="#0E5045" />
        <path d="M-10 445C95 405 146 430 218 456C313 493 389 447 462 426C553 399 593 419 667 451" stroke="#FCF7E7" strokeWidth="3" strokeOpacity=".75"/>
        <path d="M-10 481C100 446 144 480 223 506C320 542 384 480 476 464C545 450 603 467 667 485" stroke="#DDF4E7" strokeWidth="2.5" strokeOpacity=".6"/>
        <path d="M-10 540C95 496 144 529 225 561C300 590 381 550 466 529C548 509 614 534 666 544" stroke="#D8E8D7" strokeWidth="2" strokeOpacity=".45"/>
        <path d="M315 114C306 171 306 218 329 279" stroke="#1B5547" strokeWidth="6" strokeLinecap="round" />
        <path d="M315 123C268 80 233 80 192 88C222 112 270 133 315 140Z" fill="#165849"/>
        <path d="M315 124C284 68 263 48 226 37C240 83 275 116 315 132Z" fill="#185F4E"/>
        <path d="M317 123C331 67 356 50 396 37C384 82 356 114 317 132Z" fill="#155040"/>
        <path d="M318 130C371 93 404 90 442 103C408 129 373 143 318 142Z" fill="#1A6150"/>
        <path d="M316 139C362 143 396 164 416 195C374 194 342 178 312 155Z" fill="#1D6A58"/>
        <path d="M312 142C266 142 236 161 206 195C258 190 287 170 312 155Z" fill="#1B634F"/>
        <path d="M321 169C346 188 357 209 356 236" stroke="#A86C37" strokeWidth="2" />
        <path d="M325 173C305 193 293 222 293 242" stroke="#A86C37" strokeWidth="2" />
        <ellipse cx="348" cy="219" rx="12" ry="18" transform="rotate(-21 348 219)" fill="#9B6033" />
        <ellipse cx="366" cy="231" rx="12" ry="18" transform="rotate(8 366 231)" fill="#BD8245" />
        <ellipse cx="291" cy="234" rx="12" ry="18" transform="rotate(16 291 234)" fill="#A86839" />
        <ellipse cx="309" cy="247" rx="12" ry="18" transform="rotate(-15 309 247)" fill="#C28A48" />
        <path d="M89 319H204" stroke="#F4F1E3" strokeOpacity=".44" strokeWidth="1.4"/>
        <path d="M94 329H174" stroke="#F4F1E3" strokeOpacity=".28" strokeWidth="1.4"/>
        <path d="M403 341H526" stroke="#F4F1E3" strokeOpacity=".44" strokeWidth="1.4"/>
        <path d="M431 351H528" stroke="#F4F1E3" strokeOpacity=".28" strokeWidth="1.4"/>
        <circle cx="131" cy="219" r="4" fill="#D8BB85" opacity=".9"/>
        <circle cx="493" cy="288" r="4" fill="#D8BB85" opacity=".9"/>
        <circle cx="132" cy="177" r="2" fill="#EBDEBE" opacity=".6"/>
        <circle cx="461" cy="117" r="2" fill="#EBDEBE" opacity=".6"/>
      </g>
      <path d="M68 594V264C68 120 178 34 309 34S550 120 550 264V594Q550 620 524 620H94Q68 620 68 594Z" stroke="#D2B77E" strokeWidth="2.5" />
      <path d="M43 580V258C43 103 166 9 309 9S575 103 575 258V580" stroke="#1D6857" strokeOpacity=".35" strokeWidth="1.5" strokeDasharray="3 9" />
      <path d="M109 639H508" stroke="#9C9D80" strokeOpacity=".45" />
      <circle cx="309" cy="648" r="4" fill="#C69B5F"/>
    </svg>
  )
}
