<script>
	import { enhance } from '$app/forms';
	import { fromAction } from 'svelte/attachments';

	let {
		open = false,
		title,
		description,
		confirmAction,
		hiddenInputs = {},
		invokingControl = null,
		confirmLabel = 'Confirm reset',
		enhanceSubmit = null,
		onclose = () => {}
	} = $props();

	/** @type {HTMLDialogElement} */
	let dialog;
	let submitting = $state(false);
	const dialogId = $props.id();
	const titleId = `${dialogId}-title`;
	const descriptionId = `${dialogId}-description`;

	/** @param {boolean} shouldOpen @returns {import('svelte/attachments').Attachment<HTMLDialogElement>} */
	function dialogState(shouldOpen) {
		return (node) => {
			dialog = node;
			if (shouldOpen && !node.open) node.showModal();
			if (!shouldOpen && node.open) node.close();
			if (!shouldOpen) submitting = false;
		};
	}

	export function showModal() {
		if (!dialog.open) dialog.showModal();
	}

	function dismiss() {
		if (submitting) return;
		if (dialog.open) dialog.close();
		onclose();
		queueMicrotask(() => invokingControl?.focus());
	}

	/** @param {Event} event */
	function handleCancel(event) {
		event.preventDefault();
		dismiss();
	}

	/** @param {KeyboardEvent} event */
	function handleKeydown(event) {
		if (event.key === 'Escape') {
			event.preventDefault();
			dismiss();
			return;
		}
		if (event.key !== 'Tab') return;
		const focusable = [
			...dialog.querySelectorAll(
				'button:not(:disabled), input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]'
			)
		];
		if (focusable.length === 0) return;
		const first = /** @type {HTMLElement} */ (focusable[0]);
		const last = /** @type {HTMLElement} */ (focusable.at(-1));
		if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		} else if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		}
	}

	/** @param {SubmitEvent} event */
	function handleSubmit(event) {
		if (submitting) {
			event.preventDefault();
			event.stopImmediatePropagation();
			return;
		}
		submitting = true;
		if (event.submitter instanceof HTMLButtonElement) event.submitter.disabled = true;
	}
</script>

<dialog
	{@attach dialogState(open)}
	aria-labelledby={titleId}
	aria-describedby={descriptionId}
	aria-modal="true"
	oncancel={handleCancel}
	onkeydown={handleKeydown}
	class="w-[min(32rem,calc(100%-2rem))] rounded-container border border-surface-300-700 bg-surface-50-950 p-0 text-surface-950-50 shadow-2xl backdrop:bg-black/65"
>
	<div class="space-y-5 p-6">
		<header>
			<p class="text-xs font-bold tracking-wider text-error-600-400 uppercase">
				Confirmation required
			</p>
			<h2 id={titleId} class="mt-1 h3">{title}</h2>
			<p id={descriptionId} class="mt-2 text-sm text-surface-600-400">{description}</p>
		</header>

		<form
			method="POST"
			action={confirmAction}
			onsubmit={handleSubmit}
			{@attach enhanceSubmit && fromAction(enhance, () => enhanceSubmit)}
		>
			{#each Object.entries(hiddenInputs) as [name, value] (name)}
				<input type="hidden" {name} value={value == null ? '' : String(value)} />
			{/each}
			<div class="flex flex-wrap justify-end gap-3">
				<button
					class="btn preset-tonal-surface"
					type="button"
					onclick={dismiss}
					disabled={submitting}>Cancel</button
				>
				<button class="btn preset-filled-error-500" type="submit" disabled={submitting}>
					{submitting ? 'Submitting…' : confirmLabel}
				</button>
			</div>
		</form>
	</div>
</dialog>
