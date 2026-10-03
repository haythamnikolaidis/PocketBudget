// Tailwind build config. The compiled output (app/tailwind.css) is COMMITTED, so
// the app needs no build step to run and no CDN at runtime. Regenerate it with
// `npm run build:css` whenever a Tailwind class is added or changed in
// app/index.html or app/js/*.js; CI fails if the committed file is out of date.
module.exports = {
  content: ['./app/index.html', './app/js/**/*.js'],
  theme: {
    extend: {
      colors: {
        ink: '#0f172a',
        accent: '#10b981',
      },
      // Respect the notch and the home indicator.
      spacing: { 'safe-bottom': 'env(safe-area-inset-bottom)' },
    },
  },
};
