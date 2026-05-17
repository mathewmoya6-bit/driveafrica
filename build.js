const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

// Copy index.html to dist
fs.mkdirSync('dist', { recursive: true });
fs.copyFileSync('index.html', 'dist/index.html');

// Build the React app
esbuild.build({
  entryPoints: ['src/main.jsx'],
  bundle: true,
  outfile: 'dist/bundle.js',
  platform: 'browser',
  format: 'iife',
  globalName: 'app',
  loader: {
    '.jsx': 'jsx',
    '.js': 'jsx'
  },
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  inject: ['./react-shim.js'],
  define: {
    'process.env.NODE_ENV': '"production"'
  }
}).catch(() => process.exit(1));