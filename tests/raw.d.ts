/* Vite's ?raw imports: a file's text as a string (tests read kit sources this way). */
declare module "*?raw" {
	const text: string;
	export default text;
}
