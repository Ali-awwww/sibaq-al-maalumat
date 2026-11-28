import { cp, mkdir } from 'node:fs/promises';

// بناء نسخة dist/ الثابتة للعبة — تنسخ كل ملفات الواجهة اللازمة للتشغيل.
await mkdir('dist', { recursive: true });
await Promise.all([
  cp('index.html', 'dist/index.html'),
  cp('styles.css', 'dist/styles.css'),
  cp('features.css', 'dist/features.css'),
  cp('app.js', 'dist/app.js'),
  cp('questions.js', 'dist/questions.js'),
  cp('config.js', 'dist/config.js'),
  cp('update-check.js', 'dist/update-check.js'),
]);
console.log('Static build ready in dist/');
