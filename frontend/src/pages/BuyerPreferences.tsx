import DashboardLayout from '@/components/layout/DashboardLayout';
import { PreferencesForm } from '@/components/forms/PreferencesForm';
import { useNavigate } from 'react-router-dom';

export function BuyerPreferences() {
    const navigate = useNavigate();

    return (
        <DashboardLayout>
            <div className="max-w-4xl mx-auto">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold">Buyer Preferences</h1>
                    <p className="text-muted-foreground">
                        Configure what leads you receive and your bidding limits
                    </p>
                </div>

                <PreferencesForm
                    onSuccess={() => {
                        navigate('/buyer');
                    }}
                />
            </div>
        </DashboardLayout>
    );
}

export default BuyerPreferences;
