/** Pages-only build substitution. Never used by the Node API.
 * The worker accepts JSON strings, not callbacks/objects from extensions.
 * Its participants and configuration are created by our own code. JavaScript
 * cannot detect Proxy portably; structured messaging + JSON parsing is the
 * external boundary here, not the Node plugin API's hostile-object contract.
 */
export function loadProxyDetector(): (value: unknown) => boolean {
  return () => false;
}
