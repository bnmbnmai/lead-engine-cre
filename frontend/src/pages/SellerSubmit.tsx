import { useNavigate } from 'react-router-dom';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { LeadSubmitForm } from '@/components/forms/LeadSubmitForm';

export function SellerSubmit() {
    const navigate = useNavigate();

    return (
        <DashboardLayout>
            <div className="max-w-2xl mx-auto">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold">Submit Lead</h1>
                    <p className="text-muted-foreground">
                        Add a new lead to the marketplace for buyers to bid on
                    </p>
                </div>

                <LeadSubmitForm
                    onSuccess={(lead) => {
                        navigate(`/lead/${lead.id}`);
                    }}
                />
            </div>
        </DashboardLayout>
    );
}

export default SellerSubmit;
