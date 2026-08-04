import { createContext } from 'svelte';

/**
 * @typedef {Object} PageMeta
 * @property {string | undefined} title
 * @property {string | undefined} description
 */

/** @typedef {[() => PageMeta, (context: PageMeta) => PageMeta]} PageMetaContext */

export const [getPageMetaContext, setPageMetaContext] = /** @type {PageMetaContext} */ createContext();