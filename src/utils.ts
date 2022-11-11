export function isPromise<T>(obj:any) : obj is Promise<T> {
    return !!obj && (typeof obj === 'object' || typeof obj === 'function') && typeof obj.then === 'function';
}

export function asleep(milliseconds:number) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export async function poll(timeout:number, interval:number, test: ()=>(boolean | Promise<boolean>)) {
    const wrapTest = async  () => {
        try {
            const res = test();
            if(isPromise(res)) {
                return await res;
            } else {
                return res;
            }
        } catch (err:any) {
            return false;
        }
    };

    let elapsed=0; 
    while(elapsed<timeout && !(await wrapTest())) {
        await asleep(interval);
        elapsed+=interval;
    }
}
