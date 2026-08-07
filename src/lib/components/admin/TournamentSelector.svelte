<script>
	let { tournaments, selectedTournament, action } = $props();
</script>

<form method="GET" {action} class="flex flex-wrap items-end gap-3">
	<label class="label min-w-64 flex-1">
		<span class="label-text">Tournament scope</span>
		<select class="select" name="tournament" value={selectedTournament?.id ?? ''}>
			<option value="">{tournaments.length ? 'Select a tournament' : 'No tournaments yet'}</option>
			{#each tournaments as tournament (tournament.id)}
				<option value={tournament.id}>{tournament.name}</option>
			{/each}
		</select>
	</label>
	<button class="btn preset-tonal-primary" type="submit" disabled={!tournaments.length}>Load</button
	>
</form>
