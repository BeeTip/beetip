import { Chat } from "../../../components/orders";
export default async function Page({ params }: { params: Promise<{ orderId: string }> }) { const { orderId } = await params; return <Chat id={orderId} />; }
