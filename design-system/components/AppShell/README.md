# AppShell

Authenticated frame. iPhone: compact translucent top bar (wordmark + action), large-title content, bottom TabBar. Desktop: Sidebar + content up to `max-w-5xl`.

Source: `src/components/creatorco/shells.tsx`. Props: `nav`, `sidebarFooter?`, `topBarAction?`, `children`, `className?`.

Includes a skip link, `main#main`, safe-area padding, `pb-tabbar` and the **ComplianceNote** at the end of every page. Creators get Home · Passport · Access · Account; staff get the console nav.
