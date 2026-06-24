export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

export interface ApiErrorData {
  errorCode: string;
}
