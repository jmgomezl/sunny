import { Sunny, type Mood, type Reaction } from './Sunny'

// Sunny's Telegram sticker pack is drawn from the real character: open the Mini App with
// ?sticker=<pose> and it renders just Sunny, in that pose, on a transparent 512×512 stage
// with a caption. A headless browser captures each pose as a PNG (bot/scripts/stickers.ts).
// With &bare it renders the pose alone, centred and without a caption: the story cards use
// those (web/public/poses). &wear=all or a list (shield,key) puts badge accessories on.

type Pose = {
  mood: Mood
  reaction?: Reaction
  frozen?: boolean
  dozing?: boolean
  wave?: boolean
  lantern?: boolean
  caption: string
  emoji: string
}

export const POSES: Record<string, Pose> = {
  gm: { mood: 'happy', wave: true, caption: 'gm', emoji: '☀️' },
  love: { mood: 'happy', reaction: 'love', caption: 'love it', emoji: '😍' },
  wagmi: { mood: 'excited', caption: 'wagmi', emoji: '🙌' },
  scam: { mood: 'worried', caption: 'scam alert!', emoji: '😱' },
  no: { mood: 'worried', reaction: 'shiver', caption: 'Solana said no', emoji: '🙅' },
  frozen: { mood: 'happy', frozen: true, caption: 'brrr', emoji: '🥶' },
  yum: { mood: 'happy', reaction: 'yum', caption: 'pocket money!', emoji: '🤑' },
  dyor: { mood: 'happy', reaction: 'scan', caption: 'DYOR', emoji: '🔍' },
  dizzy: { mood: 'happy', reaction: 'dizzy', caption: 'too many charts', emoji: '😵' },
  thanks: { mood: 'happy', reaction: 'blush', caption: 'thank you!', emoji: '☺️' },
  hug: { mood: 'happy', reaction: 'pat', caption: 'I got you', emoji: '🤗' },
  gn: { mood: 'sleepy', dozing: true, lantern: true, caption: 'gn', emoji: '😴' },
}

type StageProps = { pose: string; caption?: string | null; wear?: string | null; bare?: boolean; cool?: boolean }

/** `caption` overrides the pose's own words (badge art uses the badge's name). */
export function StickerStage({ pose, caption, wear, bare, cool }: StageProps) {
  const p = POSES[pose] ?? POSES.gm
  const items = wear === 'all' ? ['shades', 'shield', 'key'] : (wear ?? '').split(',')
  return (
    <div className={bare ? 'sticker sticker--bare' : 'sticker'} data-pose={pose}>
      <Sunny
        mood={p.mood}
        reaction={p.reaction ?? null}
        frozen={p.frozen}
        dozing={p.dozing}
        wave={p.wave}
        lantern={p.lantern}
        cool={cool}
        wear={{ shades: items.includes('shades'), shield: items.includes('shield'), key: items.includes('key') }}
        size={bare ? 440 : 470}
      />
      {!bare && <span className="sticker-caption">{caption ?? p.caption}</span>}
    </div>
  )
}
