import { Support } from "../../components/support";
export default async function Page({ searchParams }: { searchParams: Promise<{ orderId?: string }> }) { const { orderId } = await searchParams; return <Support orderId={orderId} />; }
