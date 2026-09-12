export function dshHomeUrl(currentUrl: string): string {
  const url = new URL(currentUrl);
  const marker = "/product-visual-workbench";
  const routeIndex = url.pathname.indexOf(marker);
  const rootPath = routeIndex >= 0 ? url.pathname.slice(0, routeIndex) || "/" : "/";
  url.pathname = rootPath.endsWith("/") ? rootPath : `${rootPath}/`;
  const desktopMarkers = [...url.searchParams.entries()].filter(([key]) => key.startsWith("dsh-desktop-"));
  url.search = "";
  for (const [key, value] of desktopMarkers) url.searchParams.append(key, value);
  url.hash = "";
  return url.toString();
}
