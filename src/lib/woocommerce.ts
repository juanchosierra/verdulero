import WooCommerceRestApi from "@woocommerce/woocommerce-rest-api";

export const wcApi = new WooCommerceRestApi({
    url: process.env.NEXT_PUBLIC_WC_URL || "https://elverdulero.com.co",
    consumerKey: process.env.WC_CONSUMER_KEY || "",
    consumerSecret: process.env.WC_CONSUMER_SECRET || "",
    version: "wc/v3"
});
