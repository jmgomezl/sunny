import { useRef, useState } from 'react'
import { motion } from 'motion/react'

// Feeding Sunny by hand: a honey coin floats beside Sunny. Drag it onto Sunny (or tap it)
// and Sunny opens wide, munches, and the wallet sheet opens with that top-up ready to sign.
// The coin only promises: nothing moves until the person signs on their own phone.

type Props = {
  amount: number
  /** Sunny's pocket is low: the coin wiggles for attention. */
  hungry: boolean
  /** Until the first feed, a little "Feed me" label shows how it works. */
  hint: boolean
  /** The coin is over Sunny's mouth (or just left it). */
  onNear: (near: boolean) => void
  onFeed: () => void
}

/**
 * How far a point (viewport coordinates) is from Sunny's middle, in Sunny-widths. Sunny opens
 * wide as the coin comes close (so its face shows before the coin covers it); a drop counts
 * once the coin is over its body.
 */
function distanceToSunny(x: number, y: number) {
  const el = document.querySelector('.sunny-slot .sunny')
  if (!el) return Infinity
  const r = el.getBoundingClientRect()
  // The body is the round top part of the button (the shadow sits below it).
  return Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.width / 2)) / r.width
}
const OPENS_WIDE = 0.85
const EATS = 0.5

export function FeedCoin({ amount, hungry, hint, onNear, onFeed }: Props) {
  const near = useRef(false)
  const onTarget = useRef(false)
  const dragged = useRef(false)
  const [eaten, setEaten] = useState(false)
  const [dragging, setDragging] = useState(false)

  const setNear = (next: boolean) => {
    if (next === near.current) return
    near.current = next
    onNear(next)
  }

  const feed = () => {
    setEaten(true)
    onFeed()
    // A fresh coin comes back once the munching is over.
    window.setTimeout(() => setEaten(false), 2600)
  }

  return (
    <div className="feed-coin-spot" data-hungry={hungry || undefined}>
      <motion.button
        type="button"
        className="feed-coin"
        aria-label={`Feed Sunny ${amount} dollars of pocket money`}
        drag
        dragSnapToOrigin
        dragMomentum={false}
        dragElastic={1}
        whileDrag={{ scale: 1.18, rotate: -8 }}
        animate={eaten ? { scale: 0, opacity: 0 } : { scale: 1, opacity: 1 }}
        transition={{ duration: eaten ? 0.16 : 0.35 }}
        // Every new touch starts fresh: phones send no click after a drag, so a flag left over
        // from a missed drag would swallow the next tap.
        onPointerDown={() => {
          dragged.current = false
        }}
        onDragStart={() => {
          dragged.current = true
          setDragging(true)
        }}
        onDrag={(_, info) => {
          const d = distanceToSunny(info.point.x - window.scrollX, info.point.y - window.scrollY)
          onTarget.current = d < EATS
          setNear(d < OPENS_WIDE)
        }}
        onDragEnd={() => {
          setDragging(false)
          const fed = onTarget.current
          onTarget.current = false
          setNear(false)
          if (fed) feed()
        }}
        // A tap (or Enter) feeds too; a drag that missed Sunny just floats back.
        onClick={() => {
          if (dragged.current) {
            dragged.current = false
            return
          }
          feed()
        }}
      >
        <span className="feed-coin-face">${amount}</span>
      </motion.button>
      {hint && !eaten && !dragging && <span className="feed-coin-hint">Feed me</span>}
    </div>
  )
}
