import { useNavigate } from 'react-router-dom';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { AskForm } from '@/components/forms/AskForm';

export function CreateAsk() {
    const navigate = useNavigate();

    return (
        <DashboardLayout>
            <div className="max-w-2xl mx-auto">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold">Create Ask</h1>
                    <p className="text-muted-foreground">
                        Set up a new lead listing with your terms and preferences
                    </p>
                </div>

                <AskForm
                    onSuccess={(ask) => {
                        navigate(`/marketplace/ask/${ask.id}`);
                    }}
                />
            </div>
        </DashboardLayout>
    );
}

export default CreateAsk;
