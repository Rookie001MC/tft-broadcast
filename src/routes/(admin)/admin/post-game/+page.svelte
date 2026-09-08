<script>
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	/** @type {import('./$types').PageProps} */
	let { data, form } = $props();
	let busy = $state(false);
	let editingAugments = $state(false);
	let copyMessage = $state('');
	async function copyRelayUrl() {
		try {
			await navigator.clipboard.writeText(data.relay.url);
			copyMessage = 'Đã copy URL.';
		} catch {
			copyMessage = 'Hãy chọn URL bên trên và copy thủ công.';
		}
	}
	let augmentCount = $derived(
		data.selectedAugments.length === 0 ? 0 : data.selectedAugments.length === 4 ? 4 : 3
	);
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
		<h2 class="h3">Player LCU Relay</h2>
		<p class="mt-3" role="status">
			{#if data.relay.passwordState === 'configured'}
				<span class="badge preset-filled-success-500">Relay password configured</span>
			{:else if data.relay.passwordState === 'waiting'}
				<span class="badge preset-filled-warning-500">Waiting for first Player LCU client</span>
			{:else}
				<span class="badge preset-filled-error-500">Relay storage unavailable</span>
			{/if}
		</p>
		<label class="mt-4 label-text block" for="relay-url">Broadcast relay URL</label>
		<div class="mt-2 flex flex-wrap gap-3">
			<input
				class="input min-w-0 flex-1"
				id="relay-url"
				readonly
				value={data.relay.url}
				onfocus={(event) => event.currentTarget.select()}
			/>
			<button type="button" class="btn preset-tonal-primary" onclick={copyRelayUrl}>Copy URL</button
			>
		</div>
		<p class="mt-2 text-sm" role="status">{copyMessage}</p>
		<p class="mt-2 text-sm text-surface-600-400">
			Mở trang admin bằng IP LAN của máy broadcast để lấy URL dùng trên máy tuyển thủ.
		</p>
		{#if data.relay.passwordState === 'unavailable'}
			<p class="mt-4 text-sm">
				Không đọc được trạng thái lưu trữ relay. Kiểm tra quyền truy cập và dữ liệu trên máy
				broadcast.
			</p>
		{:else}
			<p class="mt-4 text-sm">
				Receipt đã lưu (tối đa 1.000): <strong>{data.relay.receiptCount}</strong>
			</p>
			{#if data.relay.latestReceipt}
				<dl class="mt-3 grid gap-2 text-sm sm:grid-cols-3">
					<div>
						<dt class="text-surface-600-400">Game gần nhất</dt>
						<dd class="break-all">{data.relay.latestReceipt.gameId}</dd>
					</div>
					<div>
						<dt class="text-surface-600-400">Capture ID</dt>
						<dd class="break-all">{data.relay.latestReceipt.captureId}</dd>
					</div>
					<div>
						<dt class="text-surface-600-400">Thời gian nhận (UTC)</dt>
						<dd>
							<time datetime={data.relay.latestReceipt.receivedAt}
								>{data.relay.latestReceipt.receivedAt}</time
							>
						</dd>
					</div>
				</dl>
			{:else}
				<p class="mt-2 text-sm text-surface-600-400">Chưa nhận capture từ Player LCU client.</p>
			{/if}
		{/if}
		<div class="mt-6 space-y-3">
			<h3 class="h4">Theo dõi dữ liệu Player Relay</h3>
			<p class="text-sm text-surface-600-400">
				25 capture gần nhất · tự cập nhật mỗi 3 giây. Tạm dừng cập nhật khi đang chỉnh lõi hoặc lưu
				form.
			</p>
			{#if data.relay.recentReceipts.length}
				<div class="overflow-x-auto">
					<table class="table w-full text-sm">
						<thead
							><tr
								><th>Tuyển thủ / Client</th><th>Game</th><th>Trạng thái</th><th
									>Server nhận (UTC)</th
								><th>Capture ID</th></tr
							></thead
						>
						<tbody>
							{#each data.relay.recentReceipts as receipt (receipt.captureId)}
								<tr>
									<td
										><div>{receipt.playerName || 'Chưa có tên tuyển thủ'}</div>
										<div class="mt-1 font-mono text-xs text-surface-600-400">
											{receipt.installationId || 'Client ID không có trong receipt'}
										</div></td
									>
									<td>{receipt.gameId}</td>
									<td><span class="badge preset-filled-success-500">Server đã nhận</span></td>
									<td><time datetime={receipt.receivedAt}>{receipt.receivedAt}</time></td>
									<td class="font-mono text-xs">{receipt.captureId}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else if data.relay.passwordState !== 'unavailable'}
				<p class="rounded-container preset-tonal-warning p-3 text-sm">
					Đang chờ dữ liệu từ Player Relay. Chưa có capture nào được server xác nhận.
				</p>
			{/if}
			<p class="text-sm text-surface-600-400">
				“Server đã nhận” xác nhận dữ liệu đã lưu, chưa có nghĩa đã phát lên OBS. Client chưa xuất
				hiện không có nghĩa đang offline. Lỗi gửi, hàng đợi và retry ở máy tuyển thủ hiện chỉ xem
				được trên client.
			</p>
		</div>
		<ol class="mt-5 list-decimal space-y-2 pl-5 text-sm">
			<li>Mở TFT Player Relay trên một máy tuyển thủ, nhập địa chỉ máy broadcast ở trên.</li>
			<li>Nhập hoặc Generate mật khẩu relay, rồi Save settings để khởi tạo relay.</li>
			<li>Copy cùng mật khẩu sang tất cả Player LCU client còn lại và Save settings.</li>
			<li>Dùng Test connection trước trận; sau trận kiểm tra game/capture vừa nhận tại đây.</li>
		</ol>
	</section>
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
					<option value={0}>0 lõi</option><option value={3}>3 lõi</option><option value={4}
						>4 lõi</option
					>
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
		<summary class="cursor-pointer font-semibold">Legacy direct collector</summary>
		<p class="mt-2 text-sm text-surface-600-400">
			EOG_INGEST_TOKEN chỉ dành cho direct collector cũ, không cấu hình Player Relay.
		</p>
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
