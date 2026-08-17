<script>
	/** @import { WinnerBoardView } from '$lib/winner-board.js' */

	/** @type {{ board: WinnerBoardView | null, scale?: number }} */
	let { board, scale = 1 } = $props();
	import champion from '$lib/assets/fptshopunitour/champion.svg';
	import background from '$lib/assets/fptshopunitour/bg_black.png';
	import autoFitText from '$lib/utils/autoFitText';
	const PUBLICATION_IMAGE_PATH =
		/^\/media\/publications\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[a-z0-9][a-z0-9._-]*$/;

	/** @param {string | null} path */
	function catalogImage(path) {
		return path?.startsWith('https://') ||
			path?.startsWith('/media/catalog-assets/') ||
			PUBLICATION_IMAGE_PATH.test(path ?? '')
			? path
			: null;
	}

	/** @param {{ id: string, imagePath: string | null }} winner */
	function playerImage(winner) {
		if (!winner.imagePath) return null;
		if (PUBLICATION_IMAGE_PATH.test(winner.imagePath)) return winner.imagePath;
		return `/media/player-images/${encodeURIComponent(winner.id)}`;
	}

	/** @param {string} name */
	function initials(name) {
		return name
			.split(/\s+/)
			.slice(0, 2)
			.map((part) => part[0])
			.join('')
			.toUpperCase();
	}
</script>

<div class="graphic-frame" style:--graphic-scale={scale} data-testid="winner-graphic-frame">
	<div
		class="graphic-canvas"
		class:is-empty={!board}
		aria-label={board ? 'Published winner graphic' : 'No published winner'}
	>
		{#if board}
			<img class="background-layer" src={background} alt="" />
			<img class="brand-layer" src={champion} alt="" />

			<section class="winner-photo" aria-label={`Winner ${board.winner.displayName}`}>
				{#if playerImage(board.winner)}
					<img src={playerImage(board.winner)} alt={board.winner.displayName} />
				{:else}
					<span aria-hidden="true">{initials(board.winner.displayName)}</span>
				{/if}
			</section>

			<div
				class="winner-name"
				title={board.winner.displayName}
				use:autoFitText={{ min: 20, max: 36 }}
			>
				{board.winner.displayName}
			</div>

			<section class="result-content" aria-label="Winning board">
				<h1>{board.title || 'Thắng Ván'}</h1>

				<div class="champion-list" aria-label="Champions">
					{#each board.champions as champion (champion.displayOrder)}
						<article class="champion-card" title={champion.displayName}>
							{#if catalogImage(champion.iconPath)}
								<img
									src={catalogImage(champion.iconPath)}
									alt={champion.displayName}
									crossorigin="anonymous"
								/>
							{:else}
								<span class="asset-placeholder" aria-hidden="true"
									>{initials(champion.displayName)}</span
								>
							{/if}
							{#if champion.starLevel}
								<span class="stars" aria-label={`${champion.starLevel} star`}
									>{'★'.repeat(champion.starLevel)}</span
								>
							{/if}
						</article>
					{/each}
				</div>

				{#if board.augments.length}
					<div class="augment-list" aria-label="Hextech Augments">
						{#each board.augments as augment (augment.id)}
							<article class="augment-card" title={augment.displayName}>
								{#if catalogImage(augment.iconPath)}
									<img
										src={catalogImage(augment.iconPath)}
										alt={augment.displayName}
										crossorigin="anonymous"
									/>
								{:else}
									<span class="asset-placeholder" aria-hidden="true">◆</span>
								{/if}
								<span class="asset-label">{augment.displayName}</span>
							</article>
						{/each}
					</div>
				{/if}
			</section>
		{/if}
	</div>
</div>

<style>
	.graphic-frame {
		--graphic-scale: 1;
		width: calc(1920px * var(--graphic-scale));
		height: calc(1080px * var(--graphic-scale));
		overflow: hidden;
	}

	.graphic-canvas {
		position: relative;
		width: 1920px;
		height: 1080px;
		overflow: hidden;
		color: white;
		font-family: Inter, ui-sans-serif, system-ui, sans-serif;
		transform: scale(var(--graphic-scale));
		transform-origin: top left;
	}

	.graphic-canvas.is-empty {
		background: transparent;
	}

	.background-layer,
	.brand-layer {
		position: absolute;
		inset: 0;
		width: 1920px;
		height: 1080px;
		pointer-events: none;
	}

	.background-layer {
		z-index: 0;
	}

	.brand-layer {
		z-index: 1;
	}

	.winner-photo {
		position: absolute;
		top: 243px;
		left: 75px;
		z-index: 2;
		display: grid;
		width: 526px;
		height: 655px;
		place-items: center;
		overflow: hidden;
		background: #000;
		color: #facc15;
		font-size: 116px;
		font-weight: 900;
	}

	.winner-photo img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: center;
	}

	.winner-name {
		position: absolute;
		top: 925px;
		left: 85px;
		z-index: 3;

		width: 500px;
		overflow: hidden;

		color: #000000;
		font-size: 58px;
		font-weight: 1000;
		line-height: 1.1;
		letter-spacing: -0.045em;
		text-align: center;
		text-overflow: ellipsis;
		text-transform: uppercase;
		white-space: nowrap;

		/* Pure text: no polygon or banner */
		padding: 0;
		background: none;
		clip-path: none;
		-webkit-text-stroke: 0;

		font-family: 'IBM Plex Sans';
	}

	.result-content {
		position: absolute;
		top: 0;
		left: 620px;
		z-index: 3;
		width: 940px;
		height: 1035px;
	}

	h1 {
		position: absolute;
		top: 410px;
		left: 42px;
		width: 900px;
		margin: 0;
		overflow: hidden;
		font-size: 58px;
		font-weight: 900;
		line-height: 1;
		letter-spacing: -0.025em;
		text-overflow: ellipsis;
		text-transform: uppercase;
		white-space: nowrap;
		text-shadow: 0 4px 16px rgb(0 0 0 / 45%);
		font-family: 'Paladins Straight';
	}

	.champion-list {
		position: absolute;
		top: 690px;
		left: 42px;
		display: flex;
		flex-wrap: nowrap;
		gap: 10px;
		overflow: hidden;
	}

	.champion-card,
	.augment-card {
		position: relative;
		overflow: hidden;
		border: 3px solid #facc15;
		background: #111827;
		box-shadow: 0 8px 18px rgb(0 0 0 / 45%);
	}

	.champion-card {
		flex: 0 0 70px;
		width: 70px;
		height: 70px;
	}

	.champion-card > img,
	.augment-card > img,
	.asset-placeholder {
		display: grid;
		width: 100%;
		height: 100%;
		place-items: center;
		object-fit: cover;
	}

	.asset-placeholder {
		background: linear-gradient(145deg, #2b0a0a, #0b0b0b);
		color: #facc15;
		font-size: 28px;
		font-weight: 900;
	}

	.asset-label {
		position: absolute;
		right: 0;
		bottom: 0;
		left: 0;
		overflow: hidden;
		padding: 5px 6px;
		background: rgb(0 0 0 / 78%);
		font-size: 13px;
		font-weight: 800;
		line-height: 1;
		text-align: center;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.stars {
		position: absolute;
		top: 3px;
		right: 4px;
		padding: 2px 4px;
		border-radius: 4px;
		background: rgb(0 0 0 / 72%);
		color: #facc15;
		font-size: 14px;
		letter-spacing: -0.08em;
	}

	.augment-list {
		position: absolute;
		top: 922px;
		left: 42px;
		display: grid;
		grid-template-columns: repeat(3, 92px);
		gap: 20px;
	}

	.augment-card {
		width: 86px;
		height: 86px;
		border-color: #fb923c;
		border-radius: 18px;
	}

	.augment-card .asset-label {
		font-size: 11px;
	}
</style>
