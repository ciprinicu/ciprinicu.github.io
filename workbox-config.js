module.exports = {
	globDirectory: './',
	globPatterns: [
        // AICI E TOATĂ TRUPA:
		'**/*.{html,js,css,png,jpg,jpeg,svg,json,onnx,wasm}'
	],
	swSrc: 'src-sw.js',
	swDest: 'sw.js',
    globIgnores: [
        'workbox-config.js',
        'src-sw.js',
        'node_modules/**/*'
    ]
};