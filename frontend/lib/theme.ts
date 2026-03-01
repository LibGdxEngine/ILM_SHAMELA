/**
 * Token-aligned theme utilities.
 *
 * Source of truth for values: `frontend/design-tokens.json`
 *
 * Navbar mapping uses the cultural palette already used on the landing page:
 * amber for primary actions and teal/stone for supporting accents.
 */
export const navTheme = {
  shell:
    "sticky top-0 z-40 flex-shrink-0 border-b border-amber-200/80 bg-[#fffaf0]/95 shadow-[0_14px_36px_rgba(113,78,22,0.08)] backdrop-blur supports-[backdrop-filter]:bg-[#fffaf0]/90 dark:border-amber-500/20 dark:bg-gray-900/95 dark:shadow-[0_14px_36px_rgba(0,0,0,0.35)]",
  container: "relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8",
  row: "flex h-20 items-center justify-between gap-3",
  left: "flex min-w-0 items-center gap-4 md:gap-8",
  logoLink: "group inline-flex items-center gap-3 rounded-xl",
  logoIconWrap:
    "relative h-10 w-10 rounded-xl border border-amber-300/80 bg-amber-100/70 p-1 shadow-sm transition-transform duration-200 group-hover:scale-[1.03] dark:border-amber-400/30 dark:bg-amber-900/20",
  brandText:
    "truncate text-lg font-bold tracking-tight text-stone-900 dark:text-amber-100 sm:text-xl",
  brandAccent: "text-amber-700 dark:text-amber-300",
  linksWrap:
    "hidden items-center gap-1 rounded-full border border-amber-200/80 bg-white/85 px-2 py-1 shadow-sm dark:border-gray-700 dark:bg-gray-800/80 md:flex",
  linkBase:
    "inline-flex items-center rounded-full px-4 py-2 text-sm font-semibold transition-colors duration-200",
  linkActive:
    "bg-amber-700 text-white shadow-sm dark:bg-amber-500 dark:text-stone-950",
  linkInactive:
    "text-stone-700 hover:bg-amber-100 hover:text-stone-900 dark:text-gray-200 dark:hover:bg-gray-700 dark:hover:text-white",
  rightCluster: "flex items-center gap-2 sm:gap-3",
  controlButton:
    "inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-white/90 px-3 py-2 text-sm font-medium text-stone-700 shadow-sm transition-colors hover:border-amber-300 hover:bg-white dark:border-gray-600 dark:bg-gray-800/90 dark:text-gray-200 dark:hover:border-gray-500",
  controlIcon: "h-4 w-4 text-amber-700 dark:text-amber-300",
  dropdownMenu:
    "absolute z-50 mt-2 min-w-[10rem] rounded-xl border border-amber-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800",
  dropdownItem:
    "flex w-full items-center gap-2 px-4 py-2.5 text-start text-sm text-stone-700 transition-colors hover:bg-amber-50 dark:text-gray-200 dark:hover:bg-gray-700/60",
  dropdownItemActive:
    "bg-amber-100 font-semibold text-amber-900 dark:bg-amber-500/20 dark:text-amber-200",
  divider: "hidden h-6 w-px bg-amber-200/80 dark:bg-gray-600 sm:block",
  userTrigger:
    "inline-flex items-center gap-2 rounded-xl px-2 py-2 text-stone-700 transition-colors hover:bg-amber-50 dark:text-gray-200 dark:hover:bg-gray-700/60",
  userAvatar:
    "inline-flex h-8 w-8 items-center justify-center rounded-full bg-amber-700 text-sm font-semibold text-white dark:bg-amber-500 dark:text-stone-950",
  userName: "hidden text-sm font-medium sm:block",
  userMenu:
    "absolute z-50 mt-2 w-56 rounded-xl border border-amber-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800",
  userMenuHeader: "border-b border-amber-100 px-4 py-3 dark:border-gray-700",
  signInLink:
    "px-4 py-2 text-sm font-semibold text-stone-700 transition-colors hover:text-stone-900 dark:text-gray-200 dark:hover:text-white",
  signUpButton: "btn-solid-brand-sm",
  mobileToggle:
    "inline-flex items-center justify-center rounded-xl border border-amber-200 bg-white/90 p-2 text-stone-700 shadow-sm transition-colors hover:border-amber-300 hover:bg-white dark:border-gray-600 dark:bg-gray-800/90 dark:text-gray-200 dark:hover:border-gray-500 md:hidden",
  mobilePanel:
    "md:hidden border-t border-amber-200/80 bg-[#fffaf4] pb-4 pt-3 dark:border-gray-700 dark:bg-gray-900",
  mobileLinksWrap: "flex flex-col gap-1",
  mobileLinkBase:
    "inline-flex items-center rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors",
  mobileLinkActive:
    "bg-amber-700 text-white dark:bg-amber-500 dark:text-stone-950",
  mobileAuthWrap: "mt-3 border-t border-amber-100 pt-3 dark:border-gray-700",
  mobileUserCard:
    "mb-3 rounded-xl border border-amber-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800",
  mobileSignOutButton:
    "inline-flex w-full items-center justify-center rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700",
} as const;
