/**
 * Token-aligned theme utilities.
 *
 * Source of truth for values: `docs/design-system.md`
 *
 * Navbar adopts the editorial warm palette used across the landing page:
 * parchment/ivory surfaces, terracotta brand accent, olive-gray neutrals,
 * ring-based shadows instead of drop shadows.
 */
export const navTheme = {
  shell:
    "sticky top-0 z-40 flex-shrink-0 border-b border-border-cream bg-parchment/90 backdrop-blur-md supports-[backdrop-filter]:bg-parchment/80 dark:border-dark-surface dark:bg-near-black/90",
  container: "relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8",
  row: "flex h-[72px] items-center justify-between gap-3",
  left: "flex min-w-0 items-center gap-4 md:gap-8",
  logoLink:
    "group inline-flex items-center gap-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-focus-blue/60 focus:ring-offset-2 focus:ring-offset-parchment",
  logoIconWrap:
    "relative h-9 w-9 rounded-xl border border-border-warm bg-ivory p-1 transition-transform duration-200 group-hover:scale-[1.03] dark:border-dark-surface dark:bg-dark-surface",
  brandText:
    "truncate font-serif text-[19px] font-medium tracking-tight text-near-black dark:text-ivory sm:text-xl",
  brandAccent: "text-terracotta",
  linksWrap:
    "hidden items-center gap-1 rounded-full border border-border-cream bg-ivory/70 px-1.5 py-1 shadow-ring-cream dark:border-dark-surface dark:bg-dark-surface/60 md:flex",
  linkBase:
    "inline-flex items-center rounded-full px-4 py-1.5 text-sm font-medium transition-colors duration-200",
  linkActive:
    "bg-near-black text-ivory shadow-[0_0_0_1px_rgba(20,20,19,0.9)] dark:bg-ivory dark:text-near-black",
  linkInactive:
    "text-olive-gray hover:text-near-black hover:bg-warm-sand/70 dark:text-warm-silver dark:hover:bg-dark-surface dark:hover:text-ivory",
  rightCluster: "flex items-center gap-2 sm:gap-3",
  controlButton:
    "inline-flex items-center gap-2 rounded-xl border border-border-warm bg-ivory px-3 py-1.5 text-sm font-medium text-charcoal-warm shadow-ring-cream transition-all hover:shadow-ring-warm dark:border-dark-surface dark:bg-dark-surface dark:text-warm-silver",
  controlIcon: "h-4 w-4 text-terracotta",
  dropdownMenu:
    "absolute z-50 mt-2 min-w-[10rem] rounded-xl border border-border-cream bg-ivory py-1 shadow-whisper dark:border-dark-surface dark:bg-dark-surface",
  dropdownItem:
    "flex w-full items-center gap-2 px-4 py-2.5 text-start text-sm text-charcoal-warm transition-colors hover:bg-warm-sand dark:text-warm-silver dark:hover:bg-dark-warm",
  dropdownItemActive:
    "bg-warm-sand font-medium text-near-black dark:bg-dark-warm dark:text-ivory",
  divider: "hidden h-6 w-px bg-border-warm dark:bg-dark-surface sm:block",
  userTrigger:
    "inline-flex items-center gap-2 rounded-xl px-2 py-1.5 text-charcoal-warm transition-colors hover:bg-warm-sand dark:text-warm-silver dark:hover:bg-dark-surface",
  userAvatar:
    "inline-flex h-8 w-8 items-center justify-center rounded-full bg-near-black text-sm font-medium text-ivory dark:bg-ivory dark:text-near-black",
  userName: "hidden text-sm font-medium sm:block",
  userMenu:
    "absolute z-50 mt-2 w-56 rounded-xl border border-border-cream bg-ivory py-1 shadow-whisper dark:border-dark-surface dark:bg-dark-surface",
  userMenuHeader: "border-b border-border-cream px-4 py-3 dark:border-dark-surface",
  signInLink:
    "px-4 py-2 text-sm font-medium text-olive-gray transition-colors hover:text-near-black dark:text-warm-silver dark:hover:text-ivory",
  signUpButton:
    "inline-flex items-center justify-center rounded-xl bg-terracotta px-4 py-2 text-sm font-medium text-ivory shadow-[0_0_0_1px_#c96442] transition-colors hover:bg-terracotta-soft focus:outline-none focus:ring-2 focus:ring-focus-blue/60 focus:ring-offset-2 focus:ring-offset-parchment",
  mobileToggle:
    "inline-flex items-center justify-center rounded-xl border border-border-warm bg-ivory p-2 text-charcoal-warm shadow-ring-cream transition-all hover:shadow-ring-warm dark:border-dark-surface dark:bg-dark-surface dark:text-warm-silver md:hidden",
  mobilePanel:
    "md:hidden border-t border-border-cream bg-parchment pb-4 pt-3 dark:border-dark-surface dark:bg-near-black",
  mobileLinksWrap: "flex flex-col gap-1",
  mobileLinkBase:
    "inline-flex items-center rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
  mobileLinkActive:
    "bg-near-black text-ivory dark:bg-ivory dark:text-near-black",
  mobileAuthWrap: "mt-3 border-t border-border-cream pt-3 dark:border-dark-surface",
  mobileUserCard:
    "mb-3 rounded-xl border border-border-cream bg-ivory p-3 dark:border-dark-surface dark:bg-dark-surface",
  mobileSignOutButton:
    "inline-flex w-full items-center justify-center rounded-xl border border-error-crimson/30 bg-ivory px-4 py-2.5 text-sm font-medium text-error-crimson transition-colors hover:bg-error-crimson/5 dark:border-error-crimson/40 dark:bg-dark-surface",
} as const;
