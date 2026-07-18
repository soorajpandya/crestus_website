import Marquee from "react-fast-marquee";

const WORDS = ["New Season Drop", "Men", "Women", "Crafted For Every Day", "Free Shipping Over ₹1999", "Wear The Moment"];

export const MarqueeBand = ({ dark = false }) => (
  <div className={`py-5 border-y ${dark ? "bg-ink border-zinc-800" : "bg-white border-zinc-100"}`}>
    <Marquee speed={28} gradient={false} autoFill>
      {WORDS.map((w, i) => (
        <span key={i} className={`mx-8 text-xs font-semibold uppercase tracking-[0.35em] ${dark ? "text-zinc-400" : "text-zinc-400"}`}>
          {w} <span className="text-brand-magenta ml-8">✦</span>
        </span>
      ))}
    </Marquee>
  </div>
);
