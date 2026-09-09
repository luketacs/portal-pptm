module.exports = {
  content: ["./src/**/*.{html,ts}"],
  theme: {
    extend: {
      colors: {
        // Azul da marca Diamante (manual DD-0099-26, Pantone 300C / #2039F9) — substitui
        // o azul padrão do Tailwind inteiro (os 11 tons são fornecidos), então todo
        // bg-blue-*/text-blue-*/ring-blue-* já existente no app passa a usar a cor da
        // marca sem precisar tocar em nenhum template. Ancorado no 600 = cor exata da
        // marca, mesmo tom que os botões primários (bg-blue-600) já usavam.
        blue: {
          50: '#f0f2ff', 100: '#dce0fe', 200: '#b9c1fd', 300: '#8895fc',
          400: '#5165fb', 500: '#384ffa', 600: '#2039F9',
          700: '#0620e5', 800: '#051abd', 900: '#081891', 950: '#050e57',
        },
        // Laranja da marca (Pantone 1505C / #DE7128) — cor nova, não substitui
        // orange/amber do Tailwind (usados hoje pra estados de aviso/conflito). Fica
        // disponível pra uso deliberado futuro (ex.: um CTA de destaque).
        marca: {
          50: '#fdf6f2', 100: '#faebe0', 200: '#f5d3bd', 300: '#edb38c',
          400: '#e59057', 500: '#e17e3d', 600: '#DE7128',
          700: '#be5e1e', 800: '#9a4c18', 900: '#783e17', 950: '#45230d',
        },
      },
    },
  },
  plugins: [],
};
