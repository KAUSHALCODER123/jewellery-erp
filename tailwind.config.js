/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        slate: {
          50: "#FFFFFF",
          100: "#F5F5F5",
          200: "#E0E0E0",
          300: "#D0D0D0",
          400: "#B8B8B8",
          500: "#8A8A8A",
          600: "#5F5F5F",
          700: "#363636",
          800: "#242424",
          900: "#181818",
          950: "#121212"
        },
        emerald: {
          50: "#FFF9F0",
          100: "#F7ECDD",
          200: "#E9D5BF",
          300: "#D4BCA4",
          400: "#CFB08E",
          500: "#C59E3F",
          600: "#A9822D",
          700: "#7C6125",
          800: "#5A461D",
          900: "#332913",
          950: "#211A0C"
        },
        amber: {
          50: "#FFF9F0",
          100: "#F7ECDD",
          200: "#E9D5BF",
          300: "#D4BCA4",
          400: "#CFB08E",
          500: "#C59E3F",
          600: "#A9822D",
          700: "#7C6125",
          800: "#5A461D",
          900: "#332913",
          950: "#211A0C"
        }
      }
    }
  },
  plugins: []
};
