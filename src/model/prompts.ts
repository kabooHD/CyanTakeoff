// Questions the document layer asks the user (answered by UI dialogs).

/** Ask for a file's password; null when cancelled. `retry`: the last one was wrong. */
export let askPassword: (fileName: string, retry: boolean) => Promise<string | null> = async () => null;
export const setAskPassword = (fn: typeof askPassword) => { askPassword = fn; };
