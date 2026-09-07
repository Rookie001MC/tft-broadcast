/**
 * @param {HTMLElement} node
 * @param {{ max?: number, min?: number }} options
 */
function autoFitText(node, { max = 58, min = 24 } = {}) {
	let frame;

	function fit() {
		cancelAnimationFrame(frame);

		frame = requestAnimationFrame(() => {
			let low = min;
			let high = max;
			let fittedSize = min;

			while (low <= high) {
				const size = Math.floor((low + high) / 2);

				node.style.fontSize = `${size}px`;

				if (node.scrollWidth <= node.clientWidth) {
					fittedSize = size;
					low = size + 1;
				} else {
					high = size - 1;
				}
			}

			node.style.fontSize = `${fittedSize}px`;
		});
	}

	const resizeObserver = new ResizeObserver(fit);
	const mutationObserver = new MutationObserver(fit);

	resizeObserver.observe(node);
	mutationObserver.observe(node, {
		childList: true,
		characterData: true,
		subtree: true
	});

	document.fonts?.ready.then(fit);
	fit();

	return {
		update(options = {}) {
			max = options.max ?? 58;
			min = options.min ?? 24;
			fit();
		},

		destroy() {
			cancelAnimationFrame(frame);
			resizeObserver.disconnect();
			mutationObserver.disconnect();
		}
	};
}

export default autoFitText;