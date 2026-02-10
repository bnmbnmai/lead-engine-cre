import { TrendingUp, BarChart3, DollarSign, Activity } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { GlassCard } from '@/components/ui/card';

export function SellerAnalytics() {
    return (
        <DashboardLayout>
            <div className="space-y-8">
                <div>
                    <h1 className="text-3xl font-bold">Analytics</h1>
                    <p className="text-muted-foreground">Performance metrics and revenue insights</p>
                </div>

                {/* Quick Stats */}
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                    {[
                        { label: 'Revenue (30d)', value: '$0.00', icon: DollarSign, color: 'text-emerald-500' },
                        { label: 'Leads Sold (30d)', value: '0', icon: TrendingUp, color: 'text-primary' },
                        { label: 'Avg. Winning Bid', value: '$0.00', icon: BarChart3, color: 'text-amber-500' },
                        { label: 'Active Asks', value: '0', icon: Activity, color: 'text-purple-500' },
                    ].map((stat) => (
                        <GlassCard key={stat.label}>
                            <CardContent className="p-5">
                                <div className="flex items-center justify-between mb-3">
                                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                        {stat.label}
                                    </span>
                                    <stat.icon className={`h-4 w-4 ${stat.color}`} />
                                </div>
                                <p className="text-2xl font-bold">{stat.value}</p>
                            </CardContent>
                        </GlassCard>
                    ))}
                </div>

                {/* Charts Placeholder */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">Revenue Over Time</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="h-64 flex items-center justify-center text-muted-foreground rounded-lg border border-dashed border-border">
                                <div className="text-center">
                                    <BarChart3 className="h-10 w-10 mx-auto mb-3 opacity-30" />
                                    <p className="text-sm">Chart visualization coming soon</p>
                                    <p className="text-xs text-muted-foreground mt-1">Submit leads to start seeing data</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">Leads by Vertical</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="h-64 flex items-center justify-center text-muted-foreground rounded-lg border border-dashed border-border">
                                <div className="text-center">
                                    <TrendingUp className="h-10 w-10 mx-auto mb-3 opacity-30" />
                                    <p className="text-sm">Vertical breakdown coming soon</p>
                                    <p className="text-xs text-muted-foreground mt-1">Data populates as leads are sold</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">Geo Performance</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="h-48 flex items-center justify-center text-muted-foreground rounded-lg border border-dashed border-border">
                            <div className="text-center">
                                <Activity className="h-10 w-10 mx-auto mb-3 opacity-30" />
                                <p className="text-sm">Geographic performance heatmap coming soon</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </DashboardLayout>
    );
}

export default SellerAnalytics;
