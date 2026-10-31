export function normalizeCustomerReference(value){
 if(value==null)return null;
 if(typeof value!=='string'||value.length>100||/[\u0000-\u001f\u007f-\u009f]/.test(value))throw Error('CUSTOMER_REFERENCE_INVALID');
 return value.trim()||null;
}
