/**
 * Client-visible avatar upload constants.
 *
 * Duplicated from the server boundary on purpose: the client needs the size cap to
 * label the control, and importing the server-only processor into a client bundle
 * would pull `sharp` into the browser. Neither value is a security boundary. The
 * server re-checks the size, the decoded format, and every other rule regardless
 * of what the browser believed.
 */

/** Maximum ORIGINAL upload, matching the server cap. */
export const MAX_AVATAR_UPLOAD_BYTES = 4 * 1024 * 1024;

/**
 * The `accept` attribute for the file input.
 *
 * Advisory only, and deliberately not the whole story: browsers use it to filter a
 * picker, but a client can send any type it likes. The server decides from the
 * decoded image, not from this.
 */
export const AVATAR_ACCEPTED_INPUT = "image/jpeg,image/png,image/webp";
