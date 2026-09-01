import { usePath } from "./router";
import { Lobby } from "./pages/Lobby";
import { RunRoom } from "./pages/RunRoom";
import { Result } from "./pages/Result";
import { Replay } from "./pages/Replay";

export function App() {
  const path = usePath();
  const run = path.match(/^\/run\/([^/]+)\/?$/);
  if (run) return <RunRoom id={decodeURIComponent(run[1])} />;
  const res = path.match(/^\/r\/([^/]+)\/?$/);
  if (res) return <Result id={decodeURIComponent(res[1])} />;
  const rep = path.match(/^\/replay\/([^/]+)\/(\d+)\/?$/);
  if (rep) return <Replay id={decodeURIComponent(rep[1])} n={Number(rep[2])} />;
  return <Lobby />;
}
