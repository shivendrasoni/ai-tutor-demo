/** Shared class strings for the student area (native controls styled to match shadcn inputs). */
export const selectClass =
  'h-10 w-full rounded-md border border-input bg-transparent px-3 text-base shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30 dark:[&>option]:bg-card';

/** A selectable card wrapping a native radio/checkbox, highlighted when checked. */
export const choiceClass =
  'flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm transition-colors hover:bg-accent/60 has-[:checked]:border-primary has-[:checked]:bg-accent has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50';

export const choiceInputClass = 'size-4 shrink-0 accent-primary';

/** Hand-written typography for react-markdown output. */
export const markdownClass =
  'text-sm leading-relaxed text-foreground [&_p]:my-2 [&_strong]:font-semibold [&_em]:italic [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:font-semibold [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_a]:text-primary [&_a]:underline [&_blockquote]:my-2 [&_blockquote]:border-l-4 [&_blockquote]:border-primary/30 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em] [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_hr]:my-4 [&_table]:my-2 [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:px-2 [&_td]:py-1';
