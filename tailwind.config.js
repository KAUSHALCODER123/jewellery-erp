/** @type {import('tailwindcss').Config} */
// "Bridal Showroom" LIGHT theme. The whole app references the `slate`, `emerald` and
// `amber` scales (plus state colours), so the palette is controlled centrally here.
//   slate   → light surfaces + dark text (LIGHT-first: high index = light surface,
//             low index = dark text. 950 = app background, 900 = white cards,
//             100 = primary #333 text, 50 = strongest dark text incl. on gold buttons)
//   emerald → warm gold  (#D4AF37 primary accent: buttons, key figures, highlights)
//   amber   → champagne / copper (secondary CTAs, pricing, warnings)
// State scales (red/blue/sky/rose/green) are also light-first so chips read as soft
// tints with dark text on a white app. The sidebar is rendered charcoal (see index.css
// `.app-sidebar`), keeping light text within that one region.
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Neutrals — light surfaces, dark text.
        slate: {
          50: "#1F1B16",   // strongest dark text (e.g. on gold buttons via text-slate-50)
          100: "#333333",  // primary text
          200: "#444038",
          300: "#555049",  // secondary text
          400: "#6E675B",  // muted text
          500: "#857E70",  // more muted text
          600: "#A8A294",  // faint text / icons / strong borders
          700: "#D4D0C6",  // borders / dividers
          800: "#E7E3DB",  // subtle borders + faint surfaces
          900: "#FFFFFF",  // cards / headers / panels
          950: "#FBFBFB"   // app background (off-white)
        },
        // Warm gold (primary). 500 = #D4AF37 fill; 300/400 are darker golds for accent
        // TEXT on white; 900/950 are pale-gold tints for chips.
        emerald: {
          50: "#FBF7EC",
          100: "#F4E9CC",
          200: "#C9A23A",
          300: "#9C7430",
          400: "#B8902A",
          500: "#D4AF37",
          600: "#BE9A2B",
          700: "#9A7B22",
          800: "#6E5826",
          900: "#EFE0BD",
          950: "#F7EFD9"
        },
        // Champagne / copper (secondary CTAs, pricing, warnings).
        amber: {
          50: "#FBEFEA",
          100: "#F7E7C4",
          200: "#D8A98F",
          300: "#8C4E3B",
          400: "#B0664F",
          500: "#C87D65",
          600: "#A85A44",
          700: "#8C4E3B",
          800: "#5E3527",
          900: "#F2D6C9",
          950: "#FBEFEA"
        },
        // Errors — soft red tints with dark-red text.
        red: {
          50: "#FEF2F2",
          100: "#FCE4E4",
          200: "#7C1212",
          300: "#B42318",
          400: "#9A1C13",
          500: "#DC2626",
          600: "#C01F1F",
          700: "#9F1818",
          800: "#7C1212",
          900: "#FBDAD7",
          950: "#FCECEB"
        },
        rose: {
          50: "#FDECEF",
          100: "#FBD9DF",
          200: "#7A0E2C",
          300: "#BE123C",
          400: "#9F1239",
          500: "#E11D48",
          600: "#C01040",
          700: "#9F1239",
          800: "#7A0E2C",
          900: "#FBD9DF",
          950: "#FDECEF"
        },
        // Info — soft blue tints with dark-blue text.
        blue: {
          50: "#EFF5FE",
          100: "#DBE8FC",
          200: "#1E40AF",
          300: "#1D4ED8",
          400: "#2563EB",
          500: "#3B82F6",
          600: "#2563EB",
          700: "#1D4ED8",
          800: "#1E3A8A",
          900: "#DBE8FC",
          950: "#ECF3FD"
        },
        sky: {
          50: "#ECF6FC",
          100: "#D6ECF8",
          200: "#075985",
          300: "#0369A1",
          400: "#0284C7",
          500: "#0EA5E9",
          600: "#0284C7",
          700: "#0369A1",
          800: "#075985",
          900: "#D6ECF8",
          950: "#ECF6FC"
        },
        // Success — soft green tints with dark-green text.
        green: {
          50: "#ECF7EE",
          100: "#D6EFDB",
          200: "#166534",
          300: "#15803D",
          400: "#16A34A",
          500: "#22C55E",
          600: "#16A34A",
          700: "#15803D",
          800: "#166534",
          900: "#D6EFDB",
          950: "#ECF7EE"
        }
      }
    }
  },
  plugins: []
};
