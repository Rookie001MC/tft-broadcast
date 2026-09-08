<script>
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	/** @type {import('./$types').PageProps} */
	let { data, form } = $props();
	let busy = $state(false);
	let editingAugments = $state(false);
	let augmentCount = $derived(data.selectedAugments.length === 4 ? 4 : 3);
	/** @type {import('@sveltejs/kit').SubmitFunction} */
	function submit() {
		busy = true;
		return async ({ update }) => {
			try {
				await update({ reset: false });
			} finally {
				busy = false;
			}
		};
	}
	onMount(() => {
		const timer = setInterval(() => {
			if (!busy && !editingAugments) void invalidateAll();
		}, 3000);
		return () => clearInterval(timer);
	});
</script>

<svelte:head><title>Post Match · TFT Broadcast</title></svelte:head>
<div class="mx-auto max-w-7xl space-y-6 pb-16">
	<div>
		<h1 class="h1">Post Match</h1>
		<p class="mt-2 text-sm text-surface-600-400">
			Import EOG, kiểm tra đội hình và phát bảng kết quả lên OBS.
		</p>
	</div>
	<section class="card preset-outlined-surface-200-800 bg-surface-50-950 p-6">
		<h2 class="h3">Import JSON file</h2>
		<form
			method="POST"
			action="?/import"
			class="mt-5 flex flex-wrap items-center gap-3"
			enctype="multipart/form-data"
			use:enhance={submit}
		>
			<label class="label-text" for="eog-file">File JSON EOG</label>
			<input
				class="input min-w-0 flex-1"
				id="eog-file"
				name="file"
				type="file"
				accept=".json,application/json"
				required
				disabled={busy}
			/>
			<button class="btn preset-filled-primary-500" disabled={busy}
				>{busy ? 'Đang xử lý…' : 'Import & Preview'}</button
			>
		</form>
		<p class="mt-4 rounded-container preset-tonal-surface p-3 text-sm" role="status">
			{form?.message || 'Chọn file post-game từ Needlework hoặc collector. Tối đa 2 MB.'}
		</p>
	</section>
	<section class="card preset-outlined-surface-200-800 bg-surface-50-950 p-6">
		<h2 class="h3">Lõi của người đứng đầu · Ranking</h2>
		<form
			method="POST"
			action="?/augments"
			class="mt-4 space-y-4"
			use:enhance={() => {
				busy = true;
				return async ({ update }) => {
					try {
						await update({ reset: false });
						editingAugments = false;
					} finally {
						busy = false;
					}
				};
			}}
		>
			<input type="hidden" name="gameId" value={data.gameId || ''} />
			<label class="label"
				><span class="label-text">Số lõi</span>
				<select
					class="select"
					name="augmentCount"
					bind:value={augmentCount}
					onchange={() => (editingAugments = true)}
					disabled={busy || !data.gameId}
				>
					<option value={3}>3 lõi</option><option value={4}>4 lõi</option>
				</select>
			</label>
			<div class="grid gap-3 md:grid-cols-2">
				{#each [0, 1, 2, 3].slice(0, augmentCount) as slot (slot)}
					<label class="label"
						><span class="label-text">Lõi {slot + 1}</span>
						<select
							class="select"
							name={`augment${slot}`}
							value={data.selectedAugments[slot] || ''}
							onchange={() => (editingAugments = true)}
							disabled={busy || !data.gameId}
						>
							<option value="">Không có lõi</option>
							{#each data.augmentOptions as augment (augment.id)}
								<option value={augment.id} disabled={!augment.icon}
									>{augment.name} · {augment.patch}</option
								>
							{/each}
						</select>
					</label>
				{/each}
			</div>
			<button class="btn preset-filled-primary-500" disabled={busy || !data.gameId}
				>Lưu lõi vào preview</button
			>
			<p class="text-sm text-surface-600-400">
				Chọn từ snapshot đã tải. Lưu để xem trước, sau đó phát Ranking để cập nhật OBS.
			</p>
		</form>
	</section>
	<section class="card bg-transparent p-6">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<h2 class="h3">Preview {data.gameId ? `· ${data.gameId}` : ''}</h2>
		</div>
		<div class="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
			{#each [{ id: 'post-match', name: 'Post Match' }, { id: 'ranking', name: 'Ranking' }] as scene (scene.id)}
				<div class="min-w-0">
					<div class="flex flex-wrap items-center justify-between gap-3">
						<h3 class="h4">{scene.name}</h3>
						<form
							method="POST"
							action={data.scenes[scene.id].visible ? '?/hide' : '?/publish'}
							use:enhance={submit}
						>
							<input type="hidden" name="scene" value={scene.id} />
							<button
								type="submit"
								role="switch"
								aria-checked={data.scenes[scene.id].visible}
								aria-label={`Live ${scene.name}`}
								class={data.scenes[scene.id].visible
									? 'btn preset-filled-success-500'
									: 'btn preset-tonal-surface'}
								disabled={busy || (!data.scenes[scene.id].visible && !data.gameId)}
							>
								{data.scenes[scene.id].visible ? 'Live on' : 'Live off'}
							</button>
						</form>
					</div>
					<div class="preview">
						<iframe
							src={resolve(`/admin/post-game/preview?obs=1&scene=${scene.id}`)}
							title={`${scene.name} preview`}
							width="1920"
							height="1080"
						></iframe>
					</div>
					{#if scene.id === 'ranking' && data.scenes[scene.id].visible}
						<form method="POST" action="?/publish" use:enhance={submit} class="mt-3">
							<input type="hidden" name="scene" value="ranking" />
							<button class="btn preset-filled-primary-500" disabled={busy || !data.gameId}
								>Cập nhật Ranking lên OBS</button
							>
						</form>
					{/if}
					<a
						class="mt-3 btn preset-tonal-primary"
						href={resolve(`/gfx/post-game?obs=1&scene=${scene.id}`)}
						target="_blank"
						rel="noreferrer">Mở {scene.name} ↗</a
					>
				</div>
			{/each}
		</div>
		<p class="mt-2 text-sm text-surface-600-400">
			Hai scene dùng chung dữ liệu preview, bật/tắt độc lập. OBS: Post Match <code
				>/gfx/post-game?obs=1</code
			>, Ranking <code>/gfx/post-game?obs=1&amp;scene=ranking</code> · 1920 × 1080 · trong suốt.
		</p>
	</section>
	<details class="card preset-outlined-surface-200-800 bg-surface-50-950 p-6">
		<summary class="cursor-pointer font-semibold">Kết nối collector máy tuyển thủ</summary>
		<p class="mt-2 text-sm text-surface-600-400">
			server_url: địa chỉ máy broadcast (ví dụ http://IP-MAY-BROADCAST:5173).
		</p>
		<p class="mt-2 text-sm text-surface-600-400">
			Collector gửi EOG vào preview. Bật Live ở scene muốn phát sau khi kiểm tra.
		</p>
		{#if data.collectorToken}<label class="mt-4 label-text block" for="token">Collector token</label
			><input class="mt-2 input w-full" id="token" readonly value={data.collectorToken} />{:else}<p
				class="mt-2 text-sm text-surface-600-400"
			>
				Chưa cấu hình EOG_INGEST_TOKEN trên server.
			</p>{/if}
	</details>
</div>

<style>
	.preview {
		margin-top: 1.25rem;
		width: 100%;
		aspect-ratio: 16/9;
		overflow: hidden;
		container-type: inline-size;
		border-radius: var(--radius-container);
		background: transparent;
	}
	.preview iframe {
		background: transparent;
		border: 0;
		transform: scale(calc(100cqw / 1920px));
		transform-origin: top left;
	}
</style>
