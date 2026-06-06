/** @type {import('tailwindcss').Config} */
// Premium "Navy & Gold" theme. The whole app references the `slate`, `emerald` and `amber`
// scales, so the palette is controlled centrally here:
//   slate   → deep navy / charcoal surfaces + warm-ivory text (dark-first scale: low = light text, high = dark surface)
//   emerald → champagne gold  (primary accent: buttons, key figures, highlights)
//   amber   → muted copper / rose gold (secondary CTAs, pricing, warnings)
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Navy / charcoal neutrals. 950 = deepest app background, 900 = the signature
        // navy (#1E293B) used for sidebar/cards/headers, low numbers = warm ivory text.
        slate: {
          50: "#F5F3EE",
          100: "#ECE8DF",
          200: "#D6D0C4",
          300: "#ADA89A",
          400: "#8C93A1",
          500: "#6B7283",
          600: "#49526A",
          700: "#333E54",
          800: "#283449",
          900: "#1E293B",
          950: "#151E2E"
        },
        // Champagne gold (primary). 500 = #D9AB55 base; 300/400 are lighter golds for
        // accent text on dark surfaces, 600/700 are darker golds for hover/active.
        emerald: {
          50: "#FBF6EC",
          100: "#F5E9CF",
          200: "#EAD3A1",
          300: "#E2C078",
          400: "#DDB463",
          500: "#D9AB55",
          600: "#C2933C",
          700: "#9C7430",
          800: "#6E5226",
          900: "#473619",
          950: "#2C2110"
        },
        // Muted copper / rose gold (secondary CTAs, pricing, warnings).
        amber: {
          50: "#FBEFEA",
          100: "#F4D8CD",
          200: "#E8B6A4",
          300: "#DA9A84",
          400: "#D08A72",
          500: "#C87D65",
          600: "#B0664F",
          700: "#8C4E3B",
          800: "#5E3527",
          900: "#3A2118",
          950: "#24140F"
        }
      }
    }
  },
  plugins: []
};
