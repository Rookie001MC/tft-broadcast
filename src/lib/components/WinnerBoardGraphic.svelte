<script>
	/** @import { WinnerBoardView } from '$lib/winner-board.js' */

	/** @type {{ board: WinnerBoardView | null, scale?: number }} */
	let { board, scale = 1 } = $props();
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
			<div class="ambient ambient-one"></div>
			<div class="ambient ambient-two"></div>
			<section class="winner-panel">
				<div class="winner-identity">
					<div class="eyebrow">Tournament result</div>
					<h1>{board.title || 'Match winner'}</h1>
					<div class="player-row">
						{#if board.winner.imagePath}
							<img
								class="player-photo"
								src={`/media/player-images/${encodeURIComponent(board.winner.id)}`}
								alt=""
							/>
						{:else}
							<div class="player-photo player-placeholder" aria-hidden="true">
								{initials(board.winner.displayName)}
							</div>
						{/if}
						<div class="player-copy">
							<strong>{board.winner.displayName}</strong>
							{#if board.winner.riotId}<span>{board.winner.riotId}</span>{/if}
						</div>
					</div>
				</div>

				<div class="board-assets">
					<div class="asset-heading">
						<span>Winning board</span>
						<span>{board.champions.length} units</span>
					</div>
					<div class="champion-list">
						{#each board.champions as champion (champion.id)}
							<article class="champion-card">
								<div class="champion-art">
									{#if catalogImage(champion.iconPath)}
										<img src={catalogImage(champion.iconPath)} alt="" crossorigin="anonymous" />
									{:else}
										<span aria-hidden="true">{initials(champion.displayName)}</span>
									{/if}
								</div>
								<div class="champion-name" title={champion.displayName}>{champion.displayName}</div>
								{#if champion.starLevel}
									<div class="stars" aria-label={`${champion.starLevel} star`}>
										{'★'.repeat(champion.starLevel)}
									</div>
								{/if}
							</article>
						{/each}
					</div>

					{#if board.augments.length}
						<div class="augment-list" aria-label="Augments">
							{#each board.augments as augment (augment.id)}
								<div class="augment" title={augment.displayName}>
									{#if catalogImage(augment.iconPath)}
										<img src={catalogImage(augment.iconPath)} alt="" crossorigin="anonymous" />
									{:else}
										<span aria-hidden="true">◆</span>
									{/if}
									<strong>{augment.displayName}</strong>
								</div>
							{/each}
						</div>
					{/if}
				</div>
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
		color: #fff7ed;
		font-family: Inter, ui-sans-serif, system-ui, sans-serif;
		transform: scale(var(--graphic-scale));
		transform-origin: top left;
	}

	.graphic-canvas.is-empty {
		background: transparent;
	}

	.ambient {
		position: absolute;
		border-radius: 9999px;
		filter: blur(110px);
		opacity: 0.45;
	}

	.ambient-one {
		top: 240px;
		left: 40px;
		width: 540px;
		height: 540px;
		background: #f59e0b;
	}

	.ambient-two {
		right: 80px;
		bottom: 40px;
		width: 680px;
		height: 420px;
		background: #7c3aed;
	}

	.winner-panel {
		position: absolute;
		inset: 152px 104px;
		display: grid;
		grid-template-columns: 550px minmax(0, 1fr);
		gap: 64px;
		padding: 70px;
		border: 2px solid rgb(251 191 36 / 45%);
		border-radius: 44px;
		background:
			linear-gradient(135deg, rgb(15 23 42 / 96%), rgb(28 25 23 / 94%)),
			radial-gradient(circle at top left, rgb(245 158 11 / 30%), transparent 50%);
		box-shadow: 0 48px 120px rgb(0 0 0 / 55%);
	}

	.winner-identity {
		display: flex;
		min-width: 0;
		flex-direction: column;
		justify-content: center;
	}

	.eyebrow,
	.asset-heading {
		color: #fbbf24;
		font-size: 24px;
		font-weight: 800;
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}

	h1 {
		max-width: 520px;
		margin: 20px 0 48px;
		overflow: hidden;
		font-size: 76px;
		line-height: 0.96;
		letter-spacing: -0.045em;
		text-overflow: ellipsis;
		text-transform: uppercase;
	}

	.player-row {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 26px;
	}

	.player-photo {
		width: 150px;
		height: 150px;
		flex: 0 0 auto;
		border: 4px solid #fbbf24;
		border-radius: 32px;
		object-fit: cover;
		box-shadow: 0 16px 48px rgb(0 0 0 / 40%);
	}

	.player-placeholder {
		display: grid;
		place-items: center;
		background: linear-gradient(145deg, #f59e0b, #b45309);
		color: #1c1917;
		font-size: 48px;
		font-weight: 900;
	}

	.player-copy {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 12px;
	}

	.player-copy strong {
		max-width: 350px;
		overflow: hidden;
		font-size: 50px;
		line-height: 1;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.player-copy span {
		max-width: 350px;
		overflow: hidden;
		color: #cbd5e1;
		font-size: 25px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.board-assets {
		display: flex;
		min-width: 0;
		flex-direction: column;
		justify-content: center;
	}

	.asset-heading {
		display: flex;
		justify-content: space-between;
		padding-bottom: 18px;
		border-bottom: 1px solid rgb(251 191 36 / 35%);
	}

	.asset-heading span:last-child {
		color: #94a3b8;
		font-size: 20px;
	}

	.champion-list {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 18px;
		margin-top: 30px;
	}

	.champion-card {
		min-width: 0;
		padding: 12px;
		border: 1px solid rgb(255 255 255 / 12%);
		border-radius: 22px;
		background: rgb(255 255 255 / 7%);
		text-align: center;
	}

	.champion-art {
		display: grid;
		width: 100%;
		aspect-ratio: 1;
		place-items: center;
		overflow: hidden;
		border-radius: 14px;
		background: #292524;
		color: #fbbf24;
		font-size: 30px;
		font-weight: 900;
	}

	.champion-art img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.champion-name {
		margin-top: 10px;
		overflow: hidden;
		font-size: 18px;
		font-weight: 750;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.stars {
		min-height: 22px;
		color: #fbbf24;
		font-size: 17px;
		letter-spacing: 0.08em;
	}

	.augment-list {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 16px;
		margin-top: 28px;
	}

	.augment {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 13px;
		padding: 11px 14px;
		border: 1px solid rgb(167 139 250 / 35%);
		border-radius: 16px;
		background: rgb(76 29 149 / 28%);
	}

	.augment img,
	.augment > span {
		display: grid;
		width: 46px;
		height: 46px;
		flex: 0 0 auto;
		place-items: center;
		border-radius: 10px;
		object-fit: cover;
	}

	.augment strong {
		overflow: hidden;
		font-size: 16px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
