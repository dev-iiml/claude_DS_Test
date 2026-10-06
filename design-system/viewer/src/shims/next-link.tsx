import * as React from "react";
type Props = Omit<React.ComponentProps<"a">, "href"> & {
  href: string | { pathname?: string };
  prefetch?: boolean;
  replace?: boolean;
  scroll?: boolean;
};
const Link = React.forwardRef<HTMLAnchorElement, Props>(function Link(
  { href, prefetch: _p, replace: _r, scroll: _s, onClick, ...rest },
  ref,
) {
  const h = typeof href === "string" ? href : (href.pathname ?? "#");
  return (
    <a
      ref={ref}
      href={h}
      onClick={(e) => {
        e.preventDefault();
        onClick?.(e);
      }}
      {...rest}
    />
  );
});
export default Link;
