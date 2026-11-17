import { Link, useSearchParams } from 'react-router-dom';
import AssessmentReview from '../components/AssessmentReview';

export default function AssessmentReviewPage() {
  const [params] = useSearchParams();
  const batchId = params.get('batch_id');
  return <main className="page-container container"><Link to="/classroom">← Classroom</Link><h1>Review answer papers</h1>
    {batchId ? <AssessmentReview batchId={batchId} /> : <p>Select a batch in Classroom first.</p>}
  </main>;
}
