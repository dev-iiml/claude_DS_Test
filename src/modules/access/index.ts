// Server-side surface of the Access module (Stage 14). Pure pieces are imported from their files.
export { AccessError, type AccessErrorCode } from "./errors";
export {
  closeOpportunity,
  createOpportunity,
  getOpportunityForCreator,
  getOpportunityForStaff,
  listBrands,
  listOpportunitiesForCreator,
  listOpportunitiesForStaff,
  updateOpportunity,
  type CreatorAvailability,
  type CreatorOpportunityView,
  type StaffOpportunityRow,
} from "./opportunity-service";
export {
  cancelAccessRequest,
  decideAccessRequest,
  expireAccessRequests,
  listRequestsForCreator,
  requestAccess,
  type CreatorRequestView,
} from "./request-service";
export {
  countPendingRequests,
  getRequestForStaff,
  listRequestsForStaff,
  type StaffRequestDetail,
  type StaffRequestRow,
} from "./staff-views";
export { cancelPendingAccessRequests, eraseAccessRequests } from "./erasure";
