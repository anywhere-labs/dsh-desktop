/** Read the WebServer port this Host plugin needs, or fail before `listen` bound one. */
export function boundWebServerPort(server: { readonly port: number | undefined }): number {
  const port = server.port
  if (port === undefined) throw new Error('dsh-plugin-desktop-beta: the Desktop WebServer has not bound a port yet')
  return port
}
