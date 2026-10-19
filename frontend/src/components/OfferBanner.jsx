import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import "./OfferBanner.css";

const CAMPAIGNS = {
  wardrobe: {
    theme: "cream",
    eyebrow: "The wardrobe refresh",
    title: <>A fresh take.<br />Your everyday.</>,
    description: "Find your next favourite. Clothing and accessories for men and women, from ₹100.",
    image: "/images/banners/wardrobe-refresh.jpg",
    alt: "Two models in cream and brown casual tailoring against a burgundy studio backdrop",
  },
  everyday: {
    theme: "sage",
    eyebrow: "The everyday edit",
    title: <>New looks.<br />Same you.</>,
    description: "Easy layers. Everyday favourites. Give your wardrobe a fresh start.",
    image: "/images/banners/everyday-edit.jpg",
    alt: "Two models wearing sage and ivory casual layers in a softly lit green studio",
    target: "/shop?c=women",
    action: "Shop women",
    testId: "category-banner-women",
  },
  street: {
    theme: "orange",
    eyebrow: "The big style sale",
    title: <>Big looks.<br />Bigger savings.</>,
    description: "Fresh fits for your everyday rotation. Make your next look count.",
    image: "/images/banners/big-style-sale.jpg",
    alt: "Two models wearing black denim and an orange overshirt against sunlit concrete",
    target: "/shop?c=men",
    action: "Shop men",
    testId: "category-banner-men",
  },
};

export function OfferBanner({ campaign = "wardrobe", compact = false }) {
  const offer = CAMPAIGNS[campaign];
  const Heading = compact ? "h2" : "h1";

  return (
    <section
      data-testid={`offer-banner-${campaign}`}
      aria-label={`${offer.eyebrow}: 50% off every product`}
      className={`offer-banner offer-banner--${offer.theme}${compact ? " offer-banner--compact" : ""}`}
    >
      <div className="offer-banner__copy">
        <p className="offer-banner__logo" aria-label="Crestus">CRESTUS<span>.</span></p>
        <p className="offer-banner__eyebrow">{offer.eyebrow}</p>
        <Heading className="offer-banner__title">{offer.title}</Heading>
        <p className="offer-banner__discount"><strong>50%</strong><span>OFF<small>every product</small></span></p>
        <p className="offer-banner__description">{offer.description}</p>
        <div className="offer-banner__actions">
          {compact ? (
            <Link to={offer.target} data-testid={offer.testId} className="offer-banner__button">
              {offer.action} <ArrowRight size={16} aria-hidden="true" />
            </Link>
          ) : (
            <>
              <Link to="/shop?c=men" data-testid="hero-shop-men" className="offer-banner__button">
                Shop men <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <Link to="/shop?c=women" data-testid="hero-shop-women" className="offer-banner__button offer-banner__button--outline">
                Shop women <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </>
          )}
        </div>
        <p className="offer-banner__terms">No code needed. Discount already included in prices.</p>
      </div>
      <div className="offer-banner__photo">
        <img src={offer.image} alt={offer.alt} loading={compact ? "lazy" : "eager"} fetchPriority={compact ? "auto" : "high"} />
        <span className="offer-banner__photo-note" aria-hidden="true">THE CRESTUS EDIT / 2026</span>
      </div>
    </section>
  );
}
