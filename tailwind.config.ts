// Tailwind CSS config for clean UI
tailwind.config = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  darkMode: false,
  theme: {
    extend: {
      colors: {
        walnut: {
          50: '#f8f5f0',
          100: '#f0ead0',
          200: '#e6d9a8',
          300: '#d8c382',
          400: '#c9ad5a',
          500: '#8B5A2B', // Main walnut brown
          600: '#7a4e23',
          700: '#653f1d',
          800: '#502b16',
          900: '#3a2010'
        },
        cream: '#FFF8F0',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Marcellus', 'serif']
      },
      borderRadius: {
        'none': '0',
        'sm': '0',
        'md': '0',
        'lg': '0',
        'xl': '0',
        '2xl': '0',
        'full': '0'
      }
    }
  },
  plugins: []
}