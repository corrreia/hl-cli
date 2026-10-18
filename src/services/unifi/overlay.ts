/**
 * The command name of every UniFi Network operation, by `operationId`.
 *
 * `generate.ts` writes these into the spec as `x-fern-sdk-group-name` and
 * `x-fern-sdk-method-name` before running forge. It applies to every bundled
 * version, so names stay the same across versions: an operation renamed in
 * some versions has an entry under each name. Generation fails on an
 * operation missing here.
 */
import type { Overlay } from "../../../generator/overlay.ts";

const overlay: Overlay = {
	// Application and supporting resources
	getInfo: { group: "system", method: "info" },
	getCountries: { group: "countries", method: "list" },
	getDpiApplications: { group: "dpi.applications", method: "list" },
	getDpiApplicationCategories: { group: "dpi.categories", method: "list" },
	// 10.0 names
	getApplications: { group: "dpi.applications", method: "list" },
	getCategories: { group: "dpi.categories", method: "list" },
	getRadiusProfileOverviewPage: { group: "radius.profiles", method: "list" },
	getVpnServerPage: { group: "vpn.servers", method: "list" },
	getSiteToSiteVpnTunnelPage: { group: "vpn.tunnels", method: "list" },
	getWansOverviewPage: { group: "wans", method: "list" },

	// Sites
	getSiteOverviewPage: { group: "sites", method: "list" },

	// Devices
	getAdoptedDeviceOverviewPage: { group: "devices", method: "list" },
	getAdoptedDeviceDetails: { group: "devices", method: "get" },
	getAdoptedDeviceLatestStatistics: { group: "devices", method: "stats" },
	getPendingDevicePage: { group: "devices", method: "pending" },
	adoptDevice: { group: "devices", method: "adopt" },
	removeDevice: { group: "devices", method: "remove", confirm: "This removes (forgets) the device from the site." },
	executeAdoptedDeviceAction: { group: "devices", method: "action" },
	executePortAction: { group: "devices.ports", method: "action" },
	getDeviceTagPage: { group: "devices.tags", method: "list" },
	// 9.x names
	getDeviceOverviewPage: { group: "devices", method: "list" },
	getDeviceDetails: { group: "devices", method: "get" },
	getDeviceLatestStatistics: { group: "devices", method: "stats" },
	executeDeviceAction: { group: "devices", method: "action" },

	// Clients
	getConnectedClientOverviewPage: { group: "clients", method: "list" },
	getConnectedClientDetails: { group: "clients", method: "get" },
	executeConnectedClientAction: { group: "clients", method: "action" },

	// Networks
	getNetworksOverviewPage: { group: "networks", method: "list" },
	getNetworkDetails: { group: "networks", method: "get" },
	getNetworkReferences: { group: "networks", method: "references" },
	createNetwork: { group: "networks", method: "create" },
	updateNetwork: { group: "networks", method: "update" },
	deleteNetwork: { group: "networks", method: "delete" },

	// WiFi
	getWifiBroadcastPage: { group: "wifi", method: "list" },
	getWifiBroadcastDetails: { group: "wifi", method: "get" },
	createWifiBroadcast: { group: "wifi", method: "create" },
	updateWifiBroadcast: { group: "wifi", method: "update" },
	deleteWifiBroadcast: { group: "wifi", method: "delete" },

	// Firewall
	getFirewallPolicies: { group: "firewall.policies", method: "list" },
	getFirewallPolicy: { group: "firewall.policies", method: "get" },
	createFirewallPolicy: { group: "firewall.policies", method: "create" },
	updateFirewallPolicy: { group: "firewall.policies", method: "update" },
	patchFirewallPolicy: { group: "firewall.policies", method: "patch" },
	deleteFirewallPolicy: { group: "firewall.policies", method: "delete" },
	getFirewallPolicyOrdering: { group: "firewall.policies", method: "ordering" },
	updateFirewallPolicyOrdering: { group: "firewall.policies", method: "reorder" },
	getFirewallZones: { group: "firewall.zones", method: "list" },
	getFirewallZone: { group: "firewall.zones", method: "get" },
	createFirewallZone: { group: "firewall.zones", method: "create" },
	updateFirewallZone: { group: "firewall.zones", method: "update" },
	deleteFirewallZone: { group: "firewall.zones", method: "delete" },

	// ACL rules
	getAclRulePage: { group: "acl.rules", method: "list" },
	getAclRule: { group: "acl.rules", method: "get" },
	createAclRule: { group: "acl.rules", method: "create" },
	updateAclRule: { group: "acl.rules", method: "update" },
	deleteAclRule: { group: "acl.rules", method: "delete" },
	getAclRuleOrdering: { group: "acl.rules", method: "ordering" },
	updateAclRuleOrdering: { group: "acl.rules", method: "reorder" },

	// DNS policies
	getDnsPolicyPage: { group: "dns.policies", method: "list" },
	getDnsPolicy: { group: "dns.policies", method: "get" },
	createDnsPolicy: { group: "dns.policies", method: "create" },
	updateDnsPolicy: { group: "dns.policies", method: "update" },
	deleteDnsPolicy: { group: "dns.policies", method: "delete" },

	// Traffic matching lists
	getTrafficMatchingLists: { group: "traffic-lists", method: "list" },
	getTrafficMatchingList: { group: "traffic-lists", method: "get" },
	createTrafficMatchingList: { group: "traffic-lists", method: "create" },
	updateTrafficMatchingList: { group: "traffic-lists", method: "update" },
	deleteTrafficMatchingList: { group: "traffic-lists", method: "delete" },

	// Hotspot vouchers
	getVouchers: { group: "vouchers", method: "list" },
	getVoucher: { group: "vouchers", method: "get" },
	createVouchers: { group: "vouchers", method: "create" },
	deleteVoucher: { group: "vouchers", method: "delete" },
	deleteVouchers: {
		group: "vouchers",
		method: "delete-matching",
		confirm: "This deletes every voucher matching the filter.",
	},

	// Switching
	getLagPage: { group: "switching.lags", method: "list" },
	getLag: { group: "switching.lags", method: "get" },
	getMcLagDomainPage: { group: "switching.mc-lag-domains", method: "list" },
	getMcLagDomain: { group: "switching.mc-lag-domains", method: "get" },
	getSwitchStackPage: { group: "switching.stacks", method: "list" },
	getSwitchStack: { group: "switching.stacks", method: "get" },
};

export default overlay;
