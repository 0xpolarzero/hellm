import type { Model, Usage } from "@mariozechner/pi-ai";

const TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
	hour: "numeric",
	minute: "2-digit",
});

export function formatCost(cost: number): string {
	return `$${cost.toFixed(4)}`;
}

export function formatModelCost(model: Pick<Model<any>, "cost"> | null | undefined): string {
	const cost = model?.cost;
	if (!cost) return "Free";

	const input = cost.input || 0;
	const output = cost.output || 0;
	if (input === 0 && output === 0) return "Free";

	const formatNumber = (value: number): string => {
		if (value >= 100) return value.toFixed(0);
		if (value >= 10) return value.toFixed(1).replace(/\.0$/, "");
		if (value >= 1) return value.toFixed(2).replace(/\.?0+$/, "");
		return value.toFixed(3).replace(/\.?0+$/, "");
	};

	return `$${formatNumber(input)}/$${formatNumber(output)}`;
}

export function formatTokenCount(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1000000).toFixed(1)}m`;
}

export function formatUsage(usage: Usage | null | undefined): string {
	if (!usage) return "";

	const parts: string[] = [];
	if (usage.input) parts.push(`↑${formatTokenCount(usage.input)}`);
	if (usage.output) parts.push(`↓${formatTokenCount(usage.output)}`);
	if (usage.cacheRead) parts.push(`R${formatTokenCount(usage.cacheRead)}`);
	if (usage.cacheWrite) parts.push(`W${formatTokenCount(usage.cacheWrite)}`);
	if (usage.cost?.total) parts.push(formatCost(usage.cost.total));

	return parts.join(" ");
}

export function formatTimestamp(timestamp: number | string): string {
	const date = new Date(timestamp);
	if (Number.isNaN(date.getTime())) return "";
	return TIME_FORMATTER.format(date);
}

export function subsequenceScore(query: string, text: string): number {
	let queryIndex = 0;
	let textIndex = 0;
	let gaps = 0;
	let lastMatchIndex = -1;

	while (queryIndex < query.length && textIndex < text.length) {
		if (query[queryIndex] === text[textIndex]) {
			if (lastMatchIndex >= 0) {
				gaps += textIndex - lastMatchIndex - 1;
			}
			lastMatchIndex = textIndex;
			queryIndex++;
		}
		textIndex++;
	}

	if (queryIndex < query.length) return 0;
	return query.length / (query.length + gaps);
}
