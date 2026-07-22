import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <p className="headline text-5xl font-bold text-text-faint mb-2">404</p>
      <p className="text-sm text-text-dim mb-4">This story doesn't exist.</p>
      <Link to="/" className="kicker text-xs text-accent hover:underline">
        Back to front page
      </Link>
    </div>
  );
}
