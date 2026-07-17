import { useGetAnalysisById } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { AnalysisCard } from "@/components/AnalysisCard";
import { Skeleton } from "@/components/ui/skeleton";
import { useParams, Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AnalysisDetail() {
  const params = useParams();
  const idStr = params.id;
  const id = idStr ? parseInt(idStr, 10) : 0;

  const { data: analysis, isLoading, error } = useGetAnalysisById(id, {
    query: { enabled: !!id, queryKey: ['analysis', id] }
  });

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-6 mt-4">
        <div className="mb-6">
          <Link href="/history">
            <Button variant="ghost" size="sm" className="font-mono text-xs -ml-4">
              <ArrowLeft className="w-4 h-4 mr-2" /> BACK TO ARCHIVE
            </Button>
          </Link>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-[200px] w-full" />
            <Skeleton className="h-[400px] w-full" />
          </div>
        ) : error ? (
          <div className="bg-destructive/10 border border-destructive/30 text-destructive p-6 rounded-lg font-mono text-center">
            Error loading analysis {id}.
          </div>
        ) : analysis ? (
          <AnalysisCard analysis={analysis} />
        ) : null}
      </div>
    </Layout>
  );
}
